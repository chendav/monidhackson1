import type { CostEvent, DocumentManifest } from "@/contracts";
import { materializeAnalysis } from "@/lib/analysis/materialize";
import { LocalDeterministicModel } from "@/lib/analysis/local-model";
import { cleanupGate, executeCleanup, type CleanupTarget } from "@/lib/cleanup";
import { getConfig, getProductionReadiness, hasLivePipelineConfig, type AppConfig } from "@/lib/config";
import { asAppError, AppError } from "@/lib/errors";
import { auditLog } from "@/lib/logging";
import { buildPdfPageIndex, type PdfPageIndex } from "@/lib/pdf/page-index";
import { MonidAdapter, type MonidParseResult } from "@/lib/providers/monid";
import {
  estimateOpenAiBatchFailureCostMicroUsd,
  estimateOpenAiCostMicroUsd,
  ModelBatchError,
  OpenAIResponsesAdapter,
  type AnalysisModel,
  type ExtractionCallResult,
  type ModelDocumentInput
} from "@/lib/providers/openai";
import { getRunStore, type RunStore } from "@/lib/runs/store";
import { transitionRun } from "@/lib/runs/state-machine";
import type { CleanupReceipt, RunRecord } from "@/lib/runs/types";
import { getBudgetGuard, type BudgetGuard } from "@/lib/security/budget";
import { assertAggregatePages } from "@/lib/source-validation";
import { loadSource, type LoadedSource } from "@/lib/storage/source-reader";
import { getUploadStorage, stagingBlobPath, type UploadStorage } from "@/lib/storage/uploads";

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

interface ProcessingClaim {
  leaseId: string;
  fence: number;
}

async function stage(
  store: RunStore,
  runId: string,
  status: RunRecord["status"],
  claim: ProcessingClaim
) {
  return store.update(runId, (record) => transitionRun(record, status), claim);
}

function mergeTargets(current: CleanupTarget[], additions: CleanupTarget[]) {
  const result = new Map(current.map((target) => [target.resourceId, target]));
  for (const target of additions) result.set(target.resourceId, target);
  return [...result.values()];
}

function plannedInputTargets(record: RunRecord, storage: UploadStorage): CleanupTarget[] {
  if (!record.input) return [];
  return record.input.documents.flatMap((document, index): CleanupTarget[] => {
    const stageId = `staged:${record.id}:${index}`;
    if (document.source.type === "url") {
      return [{
        resourceId: stageId,
        resourceKind: "staged_source",
        controlScope: "application",
        remove: () => storage.remove(stagingBlobPath(record.id, index))
      }];
    }
    const blobPath = document.source.blob_path;
    const stagePath = stagingBlobPath(record.id, index);
    return [
      {
        resourceId: `blob:${blobPath}`,
        resourceKind: "source_blob",
        controlScope: "application",
        successDetail: "Incoming source content was purged and a verified replay-blocking fence remains until grant expiry.",
        remove: () => storage.purgeIncomingToFence(blobPath)
      },
      {
        resourceId: stageId,
        resourceKind: "staged_source",
        controlScope: "application",
        remove: () => storage.remove(stagePath)
      }
    ];
  });
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
  const readiness = getProductionReadiness(config);
  if (!readiness.ready) {
    throw new AppError("ANALYSIS_INCOMPLETE", "The production analysis pipeline is not fully configured.", {
      httpStatus: 503,
      retryable: true
    });
  }
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

  const acquired = await store.claimProcessing(runId, now());
  if (!acquired) {
    const current = await store.get(runId);
    if (!current) throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
    return current;
  }
  const initial = acquired.record;
  const claim: ProcessingClaim = { leaseId: acquired.leaseId, fence: acquired.fence };
  if (!initial.input) {
    throw new AppError("ANALYSIS_INCOMPLETE", "The run input has already been scrubbed.", { httpStatus: 410 });
  }
  cleanupTargets = plannedInputTargets(initial, uploadStorage);

  try {
    await stage(store, runId, "staging", claim);
    for (const document of initial.input.documents) {
      if (document.source.type !== "upload") continue;
      await uploadStorage.claimIncoming({
        ownerId: initial.ownerId,
        runId,
        blobPath: document.source.blob_path,
        expectedSha256: document.source.sha256,
        expectedSize: document.source.size_bytes
      });
    }
    for (const [documentIndex, document] of initial.input.documents.entries()) {
      const source = await loadSource(document, {
        uploadStorage,
        fetcher,
        runId,
        ownerId: initial.ownerId,
        documentIndex
      });
      loaded.push(source);
      cleanupTargets = mergeTargets(cleanupTargets, source.cleanupTargets);
    }
    await store.update(runId, (record) => ({
      ...record,
      cleanupExpectedResourceIds: [...new Set([
        ...record.cleanupExpectedResourceIds,
        ...cleanupTargets.filter((target) => target.controlScope === "application").map((target) => target.resourceId)
      ])],
      updatedAt: now().toISOString()
    }), claim);

    await stage(store, runId, "page_indexing", claim);
    let remainingPages = 300;
    for (const source of loaded) {
      const index = await buildPdfPageIndex(source.bytes, { maxPages: remainingPages });
      source.bytes.fill(0);
      remainingPages -= index.pagesTotal;
      indexed.push({
        source,
        index,
        amendmentNumber: source.role === "amendment" ? amendmentFromIndex(index) : null,
        solicitationNumber: solicitationFromIndex(index)
      });
    }
    assertAggregatePages(indexed.map((item) => item.index.pagesTotal));
    cleanupTargets = mergeTargets(cleanupTargets, expectedRawTargets(indexed));
    const manifests = indexed.map(manifestFor);
    await store.update(runId, (record) => ({
      ...record,
      manifests,
      cleanupExpectedResourceIds: [...new Set([
        ...record.cleanupExpectedResourceIds,
        ...cleanupTargets.filter((target) => target.controlScope === "application").map((target) => target.resourceId)
      ])],
      updatedAt: now().toISOString()
    }), claim);

    await stage(store, runId, "parsing", claim);
    const monid = live ? dependencies.monid ?? new MonidAdapter({ config, fetcher }) : null;
    const sourceReceipts: CleanupReceipt[] = [];
    for (const item of indexed) {
      if (monid) {
        const started = performance.now();
        try {
          const parserUrl = await item.source.parserUrl(new Date(now().getTime() + 5 * 60_000));
          const result = await monid.parse({ fileUrl: parserUrl, extension: "pdf", ocr: true });
          costs.push(providerCost(result, Math.round(performance.now() - started), config.MONID_PARSE_RESERVE_MICRO_USD));
          parsed.push({ ...item, markdown: result.markdown, monid: result });
        } catch (error) {
          costs.push({
            provider: "monid",
            operation: "context_dev_parse",
            status: "failed",
            actual_micro_usd: null,
            estimated_micro_usd: config.MONID_PARSE_RESERVE_MICRO_USD,
            latency_ms: Math.round(performance.now() - started),
            retry_of: null
          });
          throw error;
        }
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
      const parsedItem = parsed.at(-1);
      if (!parsedItem) {
        throw new AppError("EMPTY_PARSE", "The parser produced no document representation.", {
          retryable: true
        });
      }
      cleanupTargets = mergeTargets(cleanupTargets, parsedTargets([parsedItem]));
      // The provider now has its document representation. Delete this
      // document's immutable staging object immediately instead of retaining
      // all package inputs until every provider call finishes.
      const documentReceipts = await executeCleanup(item.source.cleanupTargets, now);
      sourceReceipts.push(...documentReceipts);
      await store.update(runId, (record) => ({
        ...record,
        costs: [...costs],
        cleanupReceipts: mergeReceipts(record.cleanupReceipts, documentReceipts),
        cleanupExpectedResourceIds: [...new Set([
          ...record.cleanupExpectedResourceIds,
          ...cleanupTargets
            .filter((target) => target.controlScope === "application")
            .map((target) => target.resourceId)
        ])],
        updatedAt: now().toISOString()
      }), claim);
      if (documentReceipts.some(
        (receipt) => receipt.controlScope === "application" && receipt.status !== "deleted"
      )) {
        throw new AppError(
          "SOURCE_CLEANUP_PENDING",
          "At least one source deletion could not be confirmed.",
          { retryable: true }
        );
      }
    }
    await store.update(runId, (record) => ({
      ...record,
      costs: [...costs],
      cleanupExpectedResourceIds: [...new Set([
        ...record.cleanupExpectedResourceIds,
        ...cleanupTargets.filter((target) => target.controlScope === "application").map((target) => target.resourceId)
      ])],
      updatedAt: now().toISOString()
    }), claim);

    await stage(store, runId, "purging_source", claim);
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
      updatedAt: now().toISOString()
    }), claim);
    if (sourceFailed) {
      throw new AppError(
        "SOURCE_CLEANUP_PENDING",
        "At least one source deletion could not be confirmed.",
        { retryable: true }
      );
    }

    await stage(store, runId, "extracting", claim);
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
    let extraction: ExtractionCallResult;
    const modelStarted = performance.now();
    try {
      extraction = await model.extract(modelInput);
      const estimatedModelCost = extraction.inputTokens === null || extraction.outputTokens === null
        ? config.OPENAI_RUN_RESERVE_MICRO_USD
        : estimateOpenAiCostMicroUsd(extraction.inputTokens, extraction.outputTokens);
      costs.push({
        provider: "openai",
        operation: live ? "responses.parse.structured_extraction" : "local_deterministic_extraction",
        status: "succeeded",
        actual_micro_usd: live ? null : 0,
        estimated_micro_usd: live ? estimatedModelCost : null,
        latency_ms: extraction.latencyMs,
        retry_of: null
      });
    } catch (error) {
      const attemptedBatchCost = error instanceof ModelBatchError
        ? estimateOpenAiBatchFailureCostMicroUsd(error)
        : null;
      if (error instanceof ModelBatchError) {
        auditLog("openai_partial_batch_failure", {
          completed_response_ids: error.completedResponseIds,
          completed_batches: error.completedResponseIds.length,
          attempted_batches: error.attemptedBatches,
          completed_input_unit_count: error.completedInputTokens,
          completed_output_unit_count: error.completedOutputTokens,
          preflight_input_unit_counts: error.preflightInputTokens,
          estimated_attempted_input_unit_count: error.estimatedAttemptedInputTokens,
          estimated_attempted_output_unit_count: error.estimatedAttemptedOutputTokens,
          estimated_attempted_micro_usd: attemptedBatchCost
        });
      }
      costs.push({
        provider: "openai",
        operation: live ? "responses.parse.structured_extraction" : "local_deterministic_extraction",
        status: "failed",
        actual_micro_usd: null,
        estimated_micro_usd: live
          ? attemptedBatchCost ?? config.OPENAI_RUN_RESERVE_MICRO_USD
          : 0,
        latency_ms: Math.round(performance.now() - modelStarted),
        retry_of: null
      });
      throw error;
    }

    await stage(store, runId, "reconciling", claim);
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

    await stage(store, runId, "verifying", claim);
    const remainingTargets = cleanupTargets.filter(
      (target) => !loaded.some((source) => source.cleanupTargets.includes(target))
    );
    const remainingReceipts = await executeCleanup(remainingTargets, now);
    let updated = await store.update(runId, (record) => {
      const cleanupReceipts = mergeReceipts(record.cleanupReceipts, remainingReceipts);
      const cleanupConfirmed = cleanupGate({
        cleanupExpectedResourceIds: record.cleanupExpectedResourceIds,
        cleanupReceipts
      });
      const candidate: RunRecord = {
        ...record,
        cleanupReceipts,
        citationReceipts: cleanupConfirmed
          ? [...record.citationReceipts, ...materialized.receipts]
          : record.citationReceipts,
        costs,
        costMicroUsd: materialized.result.costs.total_micro_usd,
        result: cleanupConfirmed ? materialized.result : null,
        cleanupConfirmed,
        updatedAt: now().toISOString()
      };
      return candidate;
    }, claim);
    if (!updated.cleanupConfirmed) {
      updated = await store.update(runId, (record) => ({
        ...transitionRun(record, "cleanup_pending"),
        result: null,
        terminalAfterCleanup: "failed"
      }), claim);
      throw new AppError(
        "SOURCE_CLEANUP_PENDING",
        "Raw-resource deletion could not be confirmed; the run is not ready.",
        { retryable: true }
      );
    }
    const finalStatus = materialized.result.decision_readiness === "ready_for_bidder_assessment"
      ? "ready"
      : "partial";
    updated = await store.update(runId, (record) => ({
      ...transitionRun(record, finalStatus),
      processingLeaseId: null,
      processingLeaseExpiresAt: null
    }), claim);
    await budget.settle(runId, updated.costMicroUsd, now());
    return updated;
  } catch (error) {
    const appError = asAppError(error);
    auditLog("run_pipeline_failed", {
      run_id: runId,
      error_code: appError.code,
      error_name: error instanceof Error ? error.name : "unknown"
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
    let failed: RunRecord;
    try {
      failed = await store.update(runId, (record) => {
      const cleanupReceipts = mergeReceipts(record.cleanupReceipts, recoveryReceipts);
      const cleanupConfirmed = cleanupGate({
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
        result: null,
        citationReceipts: [],
        terminalAfterCleanup: cleanupConfirmed ? null : "failed",
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
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
      }, claim);
    } catch (storeError) {
      const current = await store.get(runId);
      if (!current) throw storeError;
      failed = current;
    }
    await budget.settle(runId, failed.costMicroUsd, now());
    return failed;
  }
}
