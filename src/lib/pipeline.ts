import type { CostEvent, DocumentManifest } from "@/contracts";
import { materializeAnalysis } from "@/lib/analysis/materialize";
import { LocalDeterministicModel } from "@/lib/analysis/local-model";
import { cleanupGate, executeCleanup, type CleanupTarget } from "@/lib/cleanup";
import { getConfig, hasLivePipelineConfig, type AppConfig } from "@/lib/config";
import { asAppError, AppError } from "@/lib/errors";
import { auditLog } from "@/lib/logging";
import { buildPdfPageIndex, type PdfPageIndex } from "@/lib/pdf/page-index";
import { MonidAdapter, type MonidParseResult } from "@/lib/providers/monid";
import {
  OpenAIResponsesAdapter,
  type AnalysisModel,
  type ModelDocumentInput
} from "@/lib/providers/openai";
import { getRunStore, type RunStore } from "@/lib/runs/store";
import { transitionRun } from "@/lib/runs/state-machine";
import type { CleanupReceipt, RunRecord } from "@/lib/runs/types";
import { getBudgetGuard, type BudgetGuard } from "@/lib/security/budget";
import { assertAggregatePages } from "@/lib/source-validation";
import { loadSource, type LoadedSource } from "@/lib/storage/source-reader";
import { getUploadStorage, type UploadStorage } from "@/lib/storage/uploads";

interface IndexedSource {
  source: LoadedSource;
  index: PdfPageIndex;
  amendmentNumber: string | null;
  solicitationNumber: string | null;
}

interface ParsedSource extends IndexedSource {
  markdown: string;
  monid: MonidParseResult | null;
}

// The live provider phase must finish before the 800-second Workflow step
// ceiling. OpenAI has a separate 120-second timeout, leaving roughly 80
// seconds for bounded PDF indexing, cleanup, reconciliation, and persistence.
export const LIVE_NETWORK_BUDGET_MS = 600_000;

export interface PipelineDependencies {
  store?: RunStore;
  uploadStorage?: UploadStorage;
  budget?: BudgetGuard;
  config?: AppConfig;
  fetcher?: typeof fetch;
  monid?: MonidAdapter;
  model?: AnalysisModel;
  now?: () => Date;
}

function amendmentFromIndex(index: PdfPageIndex): string | null {
  const heading = index.pages.slice(0, 3).map((page) => page.text).join(" ");
  const match = heading.match(/(?:amendment\s*(?:no\.?\s*)?|revision\s+)(\d{1,3})\b/i);
  return match ? match[1].padStart(3, "0") : null;
}

function solicitationFromIndex(index: PdfPageIndex): string | null {
  const heading = index.pages.slice(0, 3).map((page) => page.text).join(" ");
  return heading.match(/(?:Solicitation\s*(?:No\.?|Number)?\s*[:#]?\s*)([A-Z0-9][A-Z0-9/-]{4,})/i)?.[1] ?? null;
}

function manifestFor(source: IndexedSource): DocumentManifest {
  return {
    document_id: source.source.documentId,
    role: source.source.role,
    source_type: source.source.sourceType,
    source_name: source.source.sourceName,
    source_url: source.source.sourceUrl,
    sha256: source.index.documentSha256,
    pages: source.index.pagesTotal,
    language: "en",
    solicitation_number: source.solicitationNumber,
    amendment_number: source.amendmentNumber,
    status: "active",
    cleanup_status: "pending"
  };
}

function expectedRawTargets(indexed: IndexedSource[]): CleanupTarget[] {
  return indexed.map(({ source, index }) => ({
    resourceId: `page-text:${source.documentId}`,
    resourceKind: "page_text" as const,
    controlScope: "application" as const,
    remove: async () => {
      for (const page of index.pages) {
        page.text = "";
        page.normalizedText = "";
      }
      for (const chunk of index.chunks) chunk.text = "";
    }
  }));
}

function parsedTargets(parsed: ParsedSource[]): CleanupTarget[] {
  return parsed.flatMap((item) => {
    const targets: CleanupTarget[] = [{
      resourceId: `parsed:${item.source.documentId}`,
      resourceKind: "parsed_markdown",
      controlScope: "application",
      remove: async () => {
        item.markdown = "";
      }
    }];
    if (item.monid) {
      targets.push({
        resourceId: `provider-artifact:${item.monid.runId}`,
        resourceKind: "provider_artifact",
        controlScope: "provider",
        unknownDetail: "No provider artifact deletion API or retention TTL has been verified."
      });
    }
    return targets;
  });
}

function mergeReceipts(existing: CleanupReceipt[], additions: CleanupReceipt[]) {
  return [...existing, ...additions];
}

async function stage(store: RunStore, runId: string, status: RunRecord["status"]) {
  return store.update(runId, (record) => transitionRun(record, status));
}

function sourceCleanupSucceeded(source: LoadedSource, receipts: CleanupReceipt[]) {
  const expected = source.cleanupTargets
    .filter((target) => target.controlScope === "application")
    .map((target) => target.resourceId);
  return expected.every((id) => receipts.some((receipt) => receipt.resourceId === id && receipt.status === "deleted"));
}

function providerCost(result: MonidParseResult, latencyMs: number, reserve: number): CostEvent {
  const isUsd = result.costCurrency?.toUpperCase() === "USD";
  const actual = isUsd && result.costMicroUsd !== null
    ? Math.max(0, Math.round(result.costMicroUsd * 1_000_000))
    : null;
  return {
    provider: "monid",
    operation: "context_dev_parse",
    status: "succeeded",
    actual_micro_usd: actual,
    estimated_micro_usd: actual === null ? reserve : null,
    latency_ms: latencyMs,
    retry_of: null
  };
}

function fetchWithDeadline(fetcher: typeof fetch, deadlineAt: number): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const remainingMs = Math.ceil(deadlineAt - performance.now());
    if (remainingMs <= 0) {
      throw new AppError(
        "ANALYSIS_INCOMPLETE",
        "The live provider time budget was exhausted.",
        { retryable: true }
      );
    }
    const deadlineSignal = AbortSignal.timeout(remainingMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, deadlineSignal])
      : deadlineSignal;
    return fetcher(input, { ...init, signal });
  }) as typeof fetch;
}

export async function processRun(runId: string, dependencies: PipelineDependencies = {}): Promise<RunRecord> {
  const config = dependencies.config ?? getConfig();
  const live = hasLivePipelineConfig(config);
  const fetcher = fetchWithDeadline(
    dependencies.fetcher ?? fetch,
    performance.now() + LIVE_NETWORK_BUDGET_MS
  );
  const store = dependencies.store ?? await getRunStore();
  const uploadStorage = dependencies.uploadStorage ?? getUploadStorage(config);
  const budget = dependencies.budget ?? getBudgetGuard(config);
  const now = dependencies.now ?? (() => new Date());
  const loaded: LoadedSource[] = [];
  const indexed: IndexedSource[] = [];
  const parsed: ParsedSource[] = [];
  let cleanupTargets: CleanupTarget[] = [];
  const costs: CostEvent[] = [];

  const initial = await store.get(runId);
  if (!initial) throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
  if (initial.status !== "queued") return initial;

  try {
    await stage(store, runId, "validating");
    await stage(store, runId, "staging");
    for (const document of initial.input.documents) {
      loaded.push(await loadSource(document, { uploadStorage, fetcher }));
    }
    cleanupTargets = loaded.flatMap((source) => source.cleanupTargets);
    await store.update(runId, (record) => ({
      ...record,
      cleanupExpectedResourceIds: cleanupTargets
        .filter((target) => target.controlScope === "application")
        .map((target) => target.resourceId),
      updatedAt: now().toISOString()
    }));

    await stage(store, runId, "page_indexing");
    let remainingPages = 300;
    for (const source of loaded) {
      const index = await buildPdfPageIndex(source.bytes, { maxPages: remainingPages });
      remainingPages -= index.pagesTotal;
      indexed.push({
        source,
        index,
        amendmentNumber: source.role === "amendment" ? amendmentFromIndex(index) : null,
        solicitationNumber: solicitationFromIndex(index)
      });
    }
    assertAggregatePages(indexed.map((item) => item.index.pagesTotal));
    cleanupTargets.push(...expectedRawTargets(indexed));
    const manifests = indexed.map(manifestFor);
    await store.update(runId, (record) => ({
      ...record,
      manifests,
      cleanupExpectedResourceIds: cleanupTargets
        .filter((target) => target.controlScope === "application")
        .map((target) => target.resourceId),
      updatedAt: now().toISOString()
    }));

    await stage(store, runId, "parsing");
    const monid = live ? dependencies.monid ?? new MonidAdapter({ config, fetcher }) : null;
    for (const item of indexed) {
      if (monid) {
        const started = performance.now();
        const parserUrl = await item.source.parserUrl(new Date(now().getTime() + 5 * 60_000));
        const result = await monid.parse({ fileUrl: parserUrl, extension: "pdf", ocr: true });
        costs.push(providerCost(result, Math.round(performance.now() - started), config.MONID_PARSE_RESERVE_MICRO_USD));
        parsed.push({ ...item, markdown: result.markdown, monid: result });
      } else {
        parsed.push({
          ...item,
          markdown: item.index.pages.map((page) => page.text).join("\n\n"),
          monid: null
        });
        costs.push({
          provider: "monid",
          operation: "local_pdfjs_fallback",
          status: "succeeded",
          actual_micro_usd: 0,
          estimated_micro_usd: null,
          latency_ms: 0,
          retry_of: null
        });
      }
    }
    cleanupTargets.push(...parsedTargets(parsed));
    await store.update(runId, (record) => ({
      ...record,
      costs: [...costs],
      cleanupExpectedResourceIds: cleanupTargets
        .filter((target) => target.controlScope === "application")
        .map((target) => target.resourceId),
      updatedAt: now().toISOString()
    }));

    await stage(store, runId, "purging_source");
    const sourceReceipts = await executeCleanup(loaded.flatMap((source) => source.cleanupTargets), now);
    const sourceFailed = sourceReceipts.some(
      (receipt) => receipt.controlScope === "application" && receipt.status !== "deleted"
    );
    const cleanedManifests = manifests.map((manifest) => {
      const source = loaded.find((item) => item.documentId === manifest.document_id);
      return {
        ...manifest,
        cleanup_status: source && sourceCleanupSucceeded(source, sourceReceipts)
          ? "deleted" as const
          : "failed" as const
      };
    });
    await store.update(runId, (record) => ({
      ...record,
      manifests: cleanedManifests,
      cleanupReceipts: mergeReceipts(record.cleanupReceipts, sourceReceipts),
      updatedAt: now().toISOString()
    }));
    if (sourceFailed) {
      throw new AppError(
        "SOURCE_CLEANUP_PENDING",
        "At least one source deletion could not be confirmed.",
        { retryable: true }
      );
    }

    await stage(store, runId, "extracting");
    const model = dependencies.model ?? (live
      ? new OpenAIResponsesAdapter(config)
      : new LocalDeterministicModel());
    const modelInput: ModelDocumentInput[] = parsed.map((item) => ({
      document_sha256: item.index.documentSha256,
      document_name: item.source.sourceName,
      role: item.source.role,
      amendment_number: item.amendmentNumber,
      parsed_markdown: item.markdown,
      evidence_chunks: item.index.chunks
    }));
    const extraction = await model.extract(modelInput);
    costs.push({
      provider: "openai",
      operation: live ? "responses.parse.structured_extraction" : "local_deterministic_extraction",
      status: "succeeded",
      actual_micro_usd: live ? null : 0,
      estimated_micro_usd: live ? config.OPENAI_RUN_RESERVE_MICRO_USD : null,
      latency_ms: extraction.latencyMs,
      retry_of: null
    });

    await stage(store, runId, "reconciling");
    const materialized = materializeAnalysis({
      draft: extraction.analysis,
      documents: indexed.map((item) => ({
        name: item.source.sourceName,
        sourceUrl: item.source.sourceUrl,
        index: item.index,
        role: item.source.role,
        amendmentNumber: item.amendmentNumber
      })),
      manifests: cleanedManifests,
      costs,
      generatedAt: now(),
      expiresAt: new Date(initial.expiresAt)
    });

    await stage(store, runId, "verifying");
    const remainingTargets = cleanupTargets.filter(
      (target) => !loaded.some((source) => source.cleanupTargets.includes(target))
    );
    const remainingReceipts = await executeCleanup(remainingTargets, now);
    let updated = await store.update(runId, (record) => {
      const cleanupReceipts = mergeReceipts(record.cleanupReceipts, remainingReceipts);
      const candidate = {
        ...record,
        cleanupReceipts,
        citationReceipts: [...record.citationReceipts, ...materialized.receipts],
        costs,
        costMicroUsd: materialized.result.costs.total_micro_usd,
        result: materialized.result,
        cleanupConfirmed: cleanupGate({
          cleanupExpectedResourceIds: record.cleanupExpectedResourceIds,
          cleanupReceipts
        }),
        updatedAt: now().toISOString()
      };
      return candidate;
    });
    if (!updated.cleanupConfirmed) {
      updated = await store.update(runId, (record) => transitionRun(record, "cleanup_pending"));
      throw new AppError(
        "SOURCE_CLEANUP_PENDING",
        "Raw-resource deletion could not be confirmed; the run is not ready.",
        { retryable: true }
      );
    }
    const finalStatus = materialized.result.blocking_unknowns.length > 0 ? "partial" : "ready";
    updated = await store.update(runId, (record) => transitionRun(record, finalStatus));
    await budget.settle(runId, updated.costMicroUsd, now());
    return updated;
  } catch (error) {
    const appError = asAppError(error);
    auditLog("run_pipeline_failed", {
      run_id: runId,
      error_code: appError.code,
      error_name: error instanceof Error ? error.name : "unknown",
      error_message: error instanceof Error ? error.message : "unknown",
      cause_name: error instanceof Error && error.cause instanceof Error ? error.cause.name : null,
      cause_message: error instanceof Error && error.cause instanceof Error ? error.cause.message : null
    });
    const alreadyDeleted = new Set(
      (await store.get(runId))?.cleanupReceipts
        .filter((receipt) => receipt.status === "deleted")
        .map((receipt) => receipt.resourceId) ?? []
    );
    const pendingTargets = cleanupTargets.filter(
      (target) => target.controlScope !== "application" || !alreadyDeleted.has(target.resourceId)
    );
    const recoveryReceipts = pendingTargets.length > 0 ? await executeCleanup(pendingTargets, now) : [];
    const failed = await store.update(runId, (record) => {
      const cleanupReceipts = mergeReceipts(record.cleanupReceipts, recoveryReceipts);
      const cleanupConfirmed = record.cleanupExpectedResourceIds.length === 0 || cleanupGate({
        cleanupExpectedResourceIds: record.cleanupExpectedResourceIds,
        cleanupReceipts
      });
      const desired = cleanupConfirmed ? "failed" : "cleanup_pending";
      let next = record;
      if (record.status !== desired && record.status !== "ready" && record.status !== "partial" && record.status !== "expired") {
        try {
          next = transitionRun(record, desired);
        } catch {
          next = { ...record, status: desired, stage: desired, progress: desired === "failed" ? 100 : 96 };
        }
      }
      return {
        ...next,
        cleanupReceipts,
        cleanupConfirmed,
        costs,
        costMicroUsd: costs.reduce(
          (total, event) => total + (event.actual_micro_usd ?? event.estimated_micro_usd ?? 0),
          0
        ),
        error: {
          code: appError.code,
          message: appError.message,
          retryable: appError.retryable,
          request_id: appError.requestId
        },
        updatedAt: now().toISOString()
      };
    });
    await budget.settle(runId, failed.costMicroUsd, now());
    return failed;
  }
}
