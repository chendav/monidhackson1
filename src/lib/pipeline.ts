import type { AnalysisResult, CostEvent, DocumentManifest } from "@/contracts";
import { materializeAnalysis } from "@/lib/analysis/materialize";
import { unresolvedRecordAuthority } from "@/lib/analysis/record-authority";
import { LocalDeterministicModel } from "@/lib/analysis/local-model";
import {
  discoverSubmissionCandidateLedger,
  scrubSubmissionCandidateLedger
} from "@/lib/analysis/submission-channel";
import { cleanupGate, executeCleanup, type CleanupTarget } from "@/lib/cleanup";
import {
  getConfig,
  getPrivateStorageProvider,
  getProductionReadiness,
  hasLivePipelineConfig,
  type AppConfig
} from "@/lib/config";
import { asAppError, AppError } from "@/lib/errors";
import { sha256Hex } from "@/lib/crypto";
import {
  buildInfrastructureCostEstimateEvents,
  infrastructureCostCommitmentMicroUsd
} from "@/lib/cost-estimates";
import { auditLog } from "@/lib/logging";
import {
  assertWorkflowRuntimeAttested,
  WORKFLOW_INTERNAL_DEADLINES_MS,
  type WorkflowRuntimeCapability,
  type WorkflowRuntimeAttestationHealth
} from "@/lib/health/workflow-runtime";
import {
  assertProviderContractsActivelyVerified,
  type ProviderContractsCapability,
  type ProviderContractsAttestationHealth
} from "@/lib/health/provider-contracts";
import {
  assertNeonCapacityAttested,
  type NeonCapacityHealth
} from "@/lib/health/neon-capacity";
import { buildPdfPageIndex, type PdfPageIndex } from "@/lib/pdf/page-index";
import {
  MonidAdapter,
  MonidTerminalProviderError,
  type MonidParseResult
} from "@/lib/providers/monid";
import {
  estimateOpenAiBatchFailureCostMicroUsd,
  estimateOpenAiCostMicroUsd,
  ModelBatchError,
  OpenAIResponsesAdapter,
  type AnalysisModel,
  type ExtractionCallResult,
  type ModelDocumentInput,
  type PaidExtractionCallbacks
} from "@/lib/providers/openai";
import { getRunStore, type RunStore } from "@/lib/runs/store";
import { createRecordAuthorityAudit } from "@/lib/runs/record-authority-audit";
import { startProcessingHeartbeat } from "@/lib/runs/processing-heartbeat";
import {
  markPaidCostAttemptStarted,
  openAiBatchAttemptId,
  settlePaidCostAttempt
} from "@/lib/runs/paid-cost-ledger";
import {
  allCapturedSourceWatchdogsClean,
  armSourceCleanupWatchdog,
  markSourceProviderCallStarted,
  markSourceProviderResultCaptured,
  recordSourceCleanupAttempt,
  recordSourceCleanupWatchdogScheduled,
  sourceCleanupAuthorized
} from "@/lib/runs/source-cleanup-watchdog";
import { transitionRun } from "@/lib/runs/state-machine";
import type { CleanupReceipt, RunRecord, SourceCleanupWatchdog } from "@/lib/runs/types";
import { getBudgetGuard, type BudgetGuard } from "@/lib/security/budget";
import { assertAggregatePages } from "@/lib/source-validation";
import { loadSource, type LoadedSource } from "@/lib/storage/source-reader";
import { getUploadStorage, stagingBlobPath, type UploadStorage } from "@/lib/storage/uploads";
import { SOURCE_CLEANUP_WATCHDOG_REGISTRATIONS_PER_BATCH } from "@/lib/workflow-cost-policy";

interface IndexedSource {
  source: LoadedSource;
  index: PdfPageIndex;
  amendmentNumber: string | null;
  solicitationNumber: string | null;
}

interface ParsedSource extends IndexedSource {
  markdown: string;
  monid: { runIdSha256: string } | null;
}

// These deadlines are part of the deployment-bound Workflow attestation. A
// release cannot reuse an older receipt after any value changes here.
export const LIVE_NETWORK_BUDGET_MS = WORKFLOW_INTERNAL_DEADLINES_MS.live_network;
export const PRE_MODEL_DEADLINE_MS = WORKFLOW_INTERNAL_DEADLINES_MS.pre_model;
export const RESULT_COMMIT_DEADLINE_MS = WORKFLOW_INTERNAL_DEADLINES_MS.result_commit;
export const MODEL_RESULT_COMMIT_RESERVE_MS = 15_000;
export const MONID_PARSE_CONCURRENCY = SOURCE_CLEANUP_WATCHDOG_REGISTRATIONS_PER_BATCH;
export const MONID_MIN_PAID_CALL_WINDOW_MS = 60_000;

export function openAiExtractionDeadline(workflowStarted: number) {
  return workflowStarted + RESULT_COMMIT_DEADLINE_MS - MODEL_RESULT_COMMIT_RESERVE_MS;
}

export function terminalStatusForAnalysis(
  analysis: Pick<AnalysisResult, "decision_readiness">
): "ready" | "partial" {
  // READY means the document analysis completed and is publishable. It does
  // not mean the bidder has supplied enough private facts to make a bid/no-bid
  // decision, nor that the public tender package is authoritatively complete.
  return analysis.decision_readiness === "incomplete" ? "partial" : "ready";
}

export interface PipelineDependencies {
  store?: RunStore;
  uploadStorage?: UploadStorage;
  budget?: BudgetGuard;
  config?: AppConfig;
  fetcher?: typeof fetch;
  monid?: MonidAdapter;
  model?: AnalysisModel;
  now?: () => Date;
  cleanupWatchdogScheduler?: (
    runId: string,
    registrationIds: string[]
  ) => Promise<string | null>;
  workflowRuntimeAttestationProbe?: () => Promise<WorkflowRuntimeAttestationHealth>;
  workflowRuntimeCapability?: WorkflowRuntimeCapability;
  providerContractsAttestationProbe?: () => Promise<ProviderContractsAttestationHealth>;
  providerContractsCapability?: ProviderContractsCapability;
  neonCapacityProbe?: () => Promise<NeonCapacityHealth>;
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
        resourceId: `provider-artifact:sha256:${item.monid.runIdSha256}`,
        resourceKind: "provider_artifact",
        controlScope: "provider",
        unknownDetail: "No provider early-delete endpoint was found or verified; the release contract spike observed a seven-day upstream artifact expiry with ZDR disabled."
      });
    }
    return targets;
  });
}

function mergeReceipts(existing: CleanupReceipt[], additions: CleanupReceipt[]) {
  const byId = new Map(existing.map((receipt) => [receipt.receiptId, receipt]));
  for (const receipt of additions) byId.set(receipt.receiptId, receipt);
  return [...byId.values()];
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
        remove: () => storage.purgeIncomingToFence(blobPath, record.id)
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

function monidCostMicroUsd(
  amount: number | null,
  currency: string | null,
  unit: "currency_major" | "micro_dollar" | null
) {
  if (amount === null || !Number.isFinite(amount) || amount < 0 || currency !== "USD" || !unit) {
    return null;
  }
  const microUsd = unit === "currency_major" ? Math.round(amount * 1_000_000) : amount;
  return Number.isSafeInteger(microUsd) && microUsd >= 0 ? microUsd : null;
}

function providerCost(result: MonidParseResult, latencyMs: number, reserve: number): CostEvent {
  const provenance = result.costProvenance;
  const provenanceMatches = provenance !== null &&
    provenance.value_unit === result.costValueUnit &&
    Number(provenance.source_value) === result.costAmount &&
    provenance.source_currency === result.costCurrency;
  const actual = provenanceMatches
    ? monidCostMicroUsd(result.costAmount, result.costCurrency, result.costValueUnit)
    : null;
  return {
    attempt_id: null,
    provider: "monid",
    operation: "context_dev_parse",
    status: "succeeded",
    actual_micro_usd: actual,
    estimated_micro_usd: actual === null ? reserve : null,
    latency_ms: latencyMs,
    retry_of: null,
    cost_provenance: actual === null ? null : provenance
  };
}

function terminalProviderCost(
  error: MonidTerminalProviderError,
  latencyMs: number,
  reserve: number,
  attemptId: string
): CostEvent {
  const candidateProvenance = error.costProvenance;
  const provenance = candidateProvenance !== null &&
    Number(candidateProvenance.source_value) === error.costAmount &&
    candidateProvenance.source_currency === error.costCurrency
    ? candidateProvenance
    : null;
  const actual = provenance
    ? monidCostMicroUsd(error.costAmount, error.costCurrency, provenance.value_unit)
    : null;
  return {
    attempt_id: attemptId,
    provider: "monid",
    operation: "context_dev_parse",
    status: "failed",
    actual_micro_usd: actual,
    estimated_micro_usd: actual === null ? reserve : null,
    latency_ms: latencyMs,
    retry_of: null,
    cost_provenance: actual === null ? null : provenance
  };
}

function pendingProviderCost(attemptId: string, reserve: number): CostEvent {
  return {
    attempt_id: attemptId,
    provider: "monid",
    operation: "context_dev_parse",
    status: "pending",
    actual_micro_usd: null,
    estimated_micro_usd: reserve,
    latency_ms: 0,
    retry_of: null,
    cost_provenance: null
  };
}

function mergeAttemptCosts(existing: CostEvent[], updates: CostEvent[]) {
  const replacements = new Map(updates
    .filter((event) => event.attempt_id)
    .map((event) => [event.attempt_id!, event]));
  const seen = new Set<string>();
  const merged = existing.map((event) => {
    if (!event.attempt_id) return event;
    const replacement = replacements.get(event.attempt_id);
    if (!replacement) return event;
    seen.add(event.attempt_id);
    return replacement;
  });
  for (const event of updates) {
    if (event.attempt_id) {
      if (!seen.has(event.attempt_id)) merged.push(event);
      continue;
    }
    const serialized = JSON.stringify(event);
    if (!merged.some((candidate) => JSON.stringify(candidate) === serialized)) {
      merged.push(event);
    }
  }
  return merged;
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

function assertBeforeDeadline(deadlineAt: number, phase: string) {
  if (performance.now() >= deadlineAt) {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      `The ${phase} time budget was exhausted before a result could be released.`,
      { retryable: true }
    );
  }
}

export function assertMonidPaidCallStartWindow(deadlineAt: number, nowMs = performance.now()) {
  if (deadlineAt - nowMs < MONID_MIN_PAID_CALL_WINDOW_MS) {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      "The remaining live-provider window is too short to start another paid parse safely.",
      { httpStatus: 503, retryable: true }
    );
  }
}

export function assertPaidProviderPlan(record: RunRecord, config: AppConfig) {
  const documentCount = record.input?.documents.length ?? 0;
  const monidCommitment = documentCount * config.MONID_PARSE_RESERVE_MICRO_USD;
  const infrastructureCommitment = documentCount > 0
      ? infrastructureCostCommitmentMicroUsd({
          documentCount,
          storageProvider: getPrivateStorageProvider(config),
          neonCostCuCeiling: config.NEON_COST_CU_CEILING,
          runTtlHours: config.RUN_TTL_HOURS
      })
    : 0;
  const plannedCommitment = monidCommitment + config.OPENAI_RUN_RESERVE_MICRO_USD +
    infrastructureCommitment;
  if (
    documentCount < 1 ||
    !Number.isSafeInteger(monidCommitment) ||
    !Number.isSafeInteger(plannedCommitment) ||
    !Number.isSafeInteger(record.reservedMicroUsd) ||
    record.reservedMicroUsd > config.MAX_RUN_COST_MICRO_USD ||
    plannedCommitment > record.reservedMicroUsd
  ) {
    throw new AppError(
      "BUDGET_EXCEEDED",
      "The complete paid-provider plan exceeds the durable run reservation.",
      { httpStatus: 503, retryable: false }
    );
  }
}

export async function processRun(runId: string, dependencies: PipelineDependencies = {}): Promise<RunRecord> {
  const workflowStarted = performance.now();
  const config = dependencies.config ?? getConfig();
  const readiness = getProductionReadiness(config);
  if (!readiness.ready) {
    throw new AppError("ANALYSIS_INCOMPLETE", "The production analysis pipeline is not fully configured.", {
      httpStatus: 503,
      retryable: true
    });
  }
  await assertWorkflowRuntimeAttested(config, {
    probe: dependencies.workflowRuntimeAttestationProbe,
    capability: dependencies.workflowRuntimeCapability
  });
  await assertProviderContractsActivelyVerified(config, {
    probe: dependencies.providerContractsAttestationProbe,
    capability: dependencies.providerContractsCapability
  });
  await assertNeonCapacityAttested(config, {
    probe: dependencies.neonCapacityProbe
  });
  const live = hasLivePipelineConfig(config);
  const fetcher = fetchWithDeadline(
    dependencies.fetcher ?? fetch,
    workflowStarted + LIVE_NETWORK_BUDGET_MS
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
  const infrastructureCostTemplate = live
    ? buildInfrastructureCostEstimateEvents({
        documentCount: initial.input.documents.length,
        storageProvider: getPrivateStorageProvider(config),
        neonCostCuCeiling: config.NEON_COST_CU_CEILING,
        runTtlHours: config.RUN_TTL_HOURS,
        observedPipelineLatencyMs: 0
      })
    : [];
  let infrastructureCostsRecorded = false;
  const recordInfrastructureCosts = () => {
    if (infrastructureCostsRecorded || infrastructureCostTemplate.length === 0) return;
    const latencyMs = Math.max(0, Math.round(performance.now() - workflowStarted));
    costs.push(...infrastructureCostTemplate.map((event) => ({
      ...event,
      latency_ms: latencyMs
    })));
    infrastructureCostsRecorded = true;
  };
  cleanupTargets = plannedInputTargets(initial, uploadStorage);
  const heartbeat = startProcessingHeartbeat({ store, runId, claim, now });
  const scheduleWatchdog = dependencies.cleanupWatchdogScheduler ??
    (async (targetRunId: string, registrationIds: string[]) => {
      const { scheduleSourceCleanupWatchdog } = await import("@/lib/runs/scheduler");
      return scheduleSourceCleanupWatchdog(targetRunId, registrationIds);
    });

  try {
    if (live) assertPaidProviderPlan(initial, config);
    heartbeat.assertHealthy();
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
      heartbeat.assertHealthy();
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
      heartbeat.assertHealthy();
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
    type ParseOutcome = {
      documentIndex: number;
      parsedItem: ParsedSource | null;
      parseError: unknown;
      workerError: unknown;
      cost: CostEvent | null;
      sourceCleanupReceipts: CleanupReceipt[];
    };
    const parseDocument = async (
      item: IndexedSource,
      documentIndex: number,
      watchdog: SourceCleanupWatchdog | null
    ): Promise<ParseOutcome> => {
      const started = performance.now();
      let parsedItem: ParsedSource | null = null;
      let parseError: unknown = null;
      let workerError: unknown = null;
      let providerCallStarted = false;
      let providerResultCaptured = false;
      let cost: CostEvent | null = null;
      if (monid) {
        try {
          assertMonidPaidCallStartWindow(workflowStarted + LIVE_NETWORK_BUDGET_MS);
          const sourceAccessExpiresAt = new Date(now().getTime() + 5 * 60_000);
          const parserUrl = await item.source.parserUrl(sourceAccessExpiresAt);
          heartbeat.assertHealthy();
          const attemptId = watchdog!.registrationId;
          const result = await monid.parse({
            fileUrl: parserUrl,
            extension: "pdf",
            ocr: true,
            beforePaidDispatch: async () => {
              // URL signing, inspect validation, DNS checks, and any prior CAS
              // work may consume the original allowance. Recheck at the last
              // async boundary before Monid's paid POST and durably record the
              // estimated attempt in the same transaction that marks it live.
              heartbeat.assertHealthy();
              assertMonidPaidCallStartWindow(workflowStarted + LIVE_NETWORK_BUDGET_MS);
              await markSourceProviderCallStarted({
                store,
                runId,
                registrationId: attemptId,
                claim,
                sourceAccessExpiresAt,
                reservedMicroUsd: config.MONID_PARSE_RESERVE_MICRO_USD,
                totalPlannedMonidAttempts: indexed.length,
                remainingOpenAiCommitmentMicroUsd: config.OPENAI_RUN_RESERVE_MICRO_USD,
                maximumRunCostMicroUsd: config.MAX_RUN_COST_MICRO_USD,
                now: now()
              });
              providerCallStarted = true;
              cost = pendingProviderCost(attemptId, config.MONID_PARSE_RESERVE_MICRO_USD);
            }
          });
          cost = providerCost(
            result,
            Math.round(performance.now() - started),
            config.MONID_PARSE_RESERVE_MICRO_USD
          );
          cost.attempt_id = attemptId;
          const markdown = result.markdown;
          const providerRunIdSha256 = sha256Hex(result.runId);
          // Retain only a one-way provider identifier digest needed for the
          // disclosure receipt. Provider payloads, temporary URLs, raw IDs,
          // and duplicate Markdown must not survive into durable run state.
          result.markdown = "";
          result.providerArtifactUrl = "";
          result.terminalPayload = null;
          await markSourceProviderResultCaptured({
            store,
            runId,
            registrationId: watchdog!.registrationId,
            providerResultIdSha256: providerRunIdSha256,
            parsedResourceId: `parsed:${item.source.documentId}`,
            costEvent: cost,
            claim,
            now: now()
          });
          providerResultCaptured = true;
          parsedItem = { ...item, markdown, monid: { runIdSha256: providerRunIdSha256 } };
        } catch (error) {
          const latencyMs = Math.round(performance.now() - started);
          cost = !providerCallStarted
            ? null
            : error instanceof MonidTerminalProviderError
            ? terminalProviderCost(
                error,
                latencyMs,
                config.MONID_PARSE_RESERVE_MICRO_USD,
                watchdog!.registrationId
              )
            : pendingProviderCost(watchdog!.registrationId, config.MONID_PARSE_RESERVE_MICRO_USD);
          if (cost) cost.latency_ms = latencyMs;
          parseError = error;
          // A provider-declared terminal lifecycle is a captured outcome. It
          // is safe to release the source once this sanitized receipt is
          // durable. Transport failures and poll exhaustion remain unknown
          // and deliberately retain the source until signed access expires.
          if (providerCallStarted && error instanceof MonidTerminalProviderError) {
            try {
              await markSourceProviderResultCaptured({
                store,
                runId,
                registrationId: watchdog!.registrationId,
                providerResultIdSha256: sha256Hex(error.providerRunId),
                costEvent: cost ?? undefined,
                claim,
                now: now()
              });
              providerResultCaptured = true;
            } catch (captureError) {
              workerError = captureError;
            }
          }
        }
      } else {
        parsedItem = {
          ...item,
          markdown: item.index.pages.map((page) => page.text).join("\n\n"),
          monid: null
        };
        cost = {
          provider: "monid",
          operation: "local_pdfjs_fallback",
          status: "succeeded",
          actual_micro_usd: 0,
          estimated_micro_usd: null,
          latency_ms: 0,
          retry_of: null
        };
      }

      // Each source is removed as soon as a successful provider result is
      // durably captured (or when no paid call started). The batch waits for
      // every started paid call, while documentIndex keeps manifests, costs,
      // and model documents deterministic.
      let sourceCleanupReceipts: CleanupReceipt[] = [];
      // A network/polling exception is not evidence that Monid stopped
      // fetching the signed source. Keep staging intact until either a success
      // result is durably captured or the persisted signed-URL window expires.
      const sourceCleanupIsSafe = !monid || !providerCallStarted || providerResultCaptured;
      if (sourceCleanupIsSafe) {
        try {
          sourceCleanupReceipts = await executeCleanup(item.source.cleanupTargets, now);
          if (watchdog) {
            await recordSourceCleanupAttempt({
              store,
              runId,
              registrationId: watchdog.registrationId,
              receipts: sourceCleanupReceipts,
              claim,
              cancelWithoutResult: !providerResultCaptured,
              now: now()
            });
          }
        } catch (error) {
          workerError ??= error;
        }
      }
      return { documentIndex, parsedItem, parseError, workerError, cost, sourceCleanupReceipts };
    };

    const parseOutcomes: ParseOutcome[] = [];
    for (let batchStart = 0; batchStart < indexed.length; batchStart += MONID_PARSE_CONCURRENCY) {
      const batch = indexed.slice(batchStart, batchStart + MONID_PARSE_CONCURRENCY);
      const batchWatchdogs: Array<SourceCleanupWatchdog | null> = [];
      if (monid) {
        // Register every source before scheduling one package watchdog for the
        // bounded parse batch. This preserves independent per-document state
        // while limiting the actual Workflow count to ceil(documents / 4).
        // Sequential registration avoids optimistic-row conflicts; no paid
        // call starts until the shared Workflow acknowledgement is durable on
        // every registration.
        for (const [offset, item] of batch.entries()) {
          heartbeat.assertHealthy();
          const documentIndex = batchStart + offset;
          const armed = await armSourceCleanupWatchdog({
            store,
            runId,
            documentIndex,
            documentId: item.source.documentId,
            resourceIds: item.source.cleanupTargets
              .filter((target) => target.controlScope === "application" &&
                (target.resourceKind === "source_blob" || target.resourceKind === "staged_source"))
              .map((target) => target.resourceId),
            claim,
            now: now()
          });
          batchWatchdogs.push(armed);
        }
        const registrationIds = batchWatchdogs.map((watchdog) => watchdog!.registrationId);
        const workflowRunId = await scheduleWatchdog(runId, registrationIds);
        if (config.NODE_ENV === "production" && !workflowRunId) {
          throw new AppError(
            "SOURCE_CLEANUP_PENDING",
            "The paid provider calls were blocked because their independent cleanup watchdog was not acknowledged.",
            { retryable: true }
          );
        }
        for (const armed of batchWatchdogs) {
          await recordSourceCleanupWatchdogScheduled({
            store,
            runId,
            registrationId: armed!.registrationId,
            workflowRunId,
            claim,
            now: now()
          });
        }
      } else {
        batchWatchdogs.push(...batch.map(() => null));
      }
      const settled = await Promise.allSettled(batch.map((item, offset) =>
        parseDocument(item, batchStart + offset, batchWatchdogs[offset])
      ));
      for (const [offset, outcome] of settled.entries()) {
        parseOutcomes.push(outcome.status === "fulfilled" ? outcome.value : {
          documentIndex: batchStart + offset,
          parsedItem: null,
          parseError: null,
          workerError: outcome.reason,
          cost: monid ? {
            provider: "monid",
            operation: "context_dev_parse",
            status: "failed",
            actual_micro_usd: null,
            estimated_micro_usd: config.MONID_PARSE_RESERVE_MICRO_USD,
            latency_ms: 0,
            retry_of: null
          } : null,
          sourceCleanupReceipts: []
        });
      }
      const batchFailed = parseOutcomes.slice(batchStart).some((outcome) =>
        outcome.parseError !== null || outcome.workerError !== null ||
        outcome.sourceCleanupReceipts.some((receipt) =>
          receipt.controlScope === "application" && receipt.status !== "deleted"
        )
      );
      if (!batchFailed) continue;

      // Do not start another paid batch after any failure. Sources that were
      // already staged but not sent to Monid are still cleaned before the
      // deterministic error is selected.
      const unstartedStart = batchStart + batch.length;
      const unstarted = await Promise.all(indexed.slice(unstartedStart).map(async (item, offset) => ({
        documentIndex: unstartedStart + offset,
        parsedItem: null,
        parseError: null,
        workerError: null,
        cost: null,
        sourceCleanupReceipts: await executeCleanup(item.source.cleanupTargets, now)
      } satisfies ParseOutcome)));
      parseOutcomes.push(...unstarted);
      break;
    }
    parseOutcomes.sort((left, right) => left.documentIndex - right.documentIndex);

    const sourceReceipts: CleanupReceipt[] = [];
    for (const outcome of parseOutcomes) {
      if (outcome.cost) costs.push(outcome.cost);
      sourceReceipts.push(...outcome.sourceCleanupReceipts);
      if (outcome.parsedItem) {
        parsed.push(outcome.parsedItem);
        cleanupTargets = mergeTargets(cleanupTargets, parsedTargets([outcome.parsedItem]));
      }
    }
    const afterSourceCleanup = await store.update(runId, (record) => ({
      ...record,
      costs: mergeAttemptCosts(record.costs, costs),
      cleanupReceipts: mergeReceipts(record.cleanupReceipts, sourceReceipts),
      cleanupExpectedResourceIds: [...new Set([
        ...record.cleanupExpectedResourceIds,
        ...cleanupTargets
          .filter((target) => target.controlScope === "application")
          .map((target) => target.resourceId)
      ])],
      updatedAt: now().toISOString()
    }), claim);
    const persistedDeletedSourceIds = new Set(afterSourceCleanup.cleanupReceipts
      .filter((receipt) => receipt.controlScope === "application" && receipt.status === "deleted")
      .map((receipt) => receipt.resourceId));
    if (sourceReceipts.some(
      (receipt) => receipt.controlScope === "application" &&
        receipt.status !== "deleted" &&
        !persistedDeletedSourceIds.has(receipt.resourceId)
    )) {
      throw new AppError(
        "SOURCE_CLEANUP_PENDING",
        "At least one source deletion could not be confirmed.",
        { retryable: true }
      );
    }
    const firstWorkerFailure = parseOutcomes.find((outcome) => outcome.workerError !== null);
    if (firstWorkerFailure) throw firstWorkerFailure.workerError;
    const firstParseFailure = parseOutcomes.find((outcome) => outcome.parseError !== null);
    if (firstParseFailure) throw firstParseFailure.parseError;
    if (parsed.length !== indexed.length) {
      throw new AppError("EMPTY_PARSE", "The parser produced no document representation.", {
        retryable: true
      });
    }
    await store.update(runId, (record) => ({
      ...record,
      costs: mergeAttemptCosts(record.costs, costs),
      cleanupExpectedResourceIds: [...new Set([
        ...record.cleanupExpectedResourceIds,
        ...cleanupTargets.filter((target) => target.controlScope === "application").map((target) => target.resourceId)
      ])],
      updatedAt: now().toISOString()
    }), claim);

    await stage(store, runId, "purging_source", claim);
    const sourceFailed = loaded.some(
      (source) => !sourceCleanupSucceeded(source, afterSourceCleanup.cleanupReceipts)
    );
    const cleanedManifests = manifests.map((manifest) => {
      const source = loaded.find((item) => item.documentId === manifest.document_id);
      return {
        ...manifest,
        cleanup_status: source && sourceCleanupSucceeded(source, afterSourceCleanup.cleanupReceipts)
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
    assertBeforeDeadline(workflowStarted + PRE_MODEL_DEADLINE_MS, "pre-model");

    await stage(store, runId, "extracting", claim);
    // The state transition is an awaited database write. Re-check afterward so
    // its latency cannot silently extend model work beyond the Workflow
    // result-commit envelope.
    assertBeforeDeadline(workflowStarted + PRE_MODEL_DEADLINE_MS, "pre-model-after-stage");
    const model = dependencies.model ?? (live
      ? new OpenAIResponsesAdapter(
          config,
          undefined,
          () => performance.now(),
          openAiExtractionDeadline(workflowStarted)
        )
      : new LocalDeterministicModel());
    const usesDurableOpenAiLedger = live && model instanceof OpenAIResponsesAdapter;
    const startedOpenAiAttempts = new Set<string>();
    const paidExtractionCallbacks: PaidExtractionCallbacks | undefined = usesDurableOpenAiLedger
      ? {
          beforePaidBatchDispatch: async (plan) => {
            heartbeat.assertHealthy();
            assertBeforeDeadline(workflowStarted + RESULT_COMMIT_DEADLINE_MS, "openai-dispatch");
            const attemptId = openAiBatchAttemptId(runId, plan.batchIndex);
            await markPaidCostAttemptStarted({
              store,
              runId,
              event: {
                attempt_id: attemptId,
                provider: "openai",
                operation: "responses.parse.structured_extraction",
                status: "pending",
                actual_micro_usd: null,
                estimated_micro_usd: plan.maximumEstimatedCostMicroUsd,
                latency_ms: 0,
                retry_of: null,
                cost_provenance: null
              },
              remainingCommitmentMicroUsd: plan.remainingMaximumEstimatedCostMicroUsd,
              maximumRunCostMicroUsd: config.MAX_RUN_COST_MICRO_USD,
              claim,
              now: now()
            });
            startedOpenAiAttempts.add(attemptId);
          },
          settlePaidBatch: async (settlement) => {
            const attemptId = openAiBatchAttemptId(runId, settlement.batchIndex);
            await settlePaidCostAttempt({
              store,
              runId,
              event: {
                attempt_id: attemptId,
                provider: "openai",
                operation: "responses.parse.structured_extraction",
                status: settlement.status,
                actual_micro_usd: null,
                estimated_micro_usd: settlement.estimatedCostMicroUsd,
                latency_ms: settlement.latencyMs,
                retry_of: null,
                cost_provenance: null
              },
              remainingCommitmentMicroUsd: settlement.remainingMaximumEstimatedCostMicroUsd,
              maximumRunCostMicroUsd: config.MAX_RUN_COST_MICRO_USD,
              claim,
              now: now()
            });
          }
        }
      : undefined;
    const submissionDocuments = indexed.map((item) => ({
      name: item.source.sourceName,
      sourceUrl: item.source.sourceUrl,
      index: item.index,
      role: item.source.role,
      amendmentNumber: item.amendmentNumber
    }));
    const submissionLedger = discoverSubmissionCandidateLedger(submissionDocuments);
    const modelInput: ModelDocumentInput[] = parsed.map((item) => ({
      document_sha256: item.index.documentSha256,
      document_name: item.source.sourceName,
      role: item.source.role,
      amendment_number: item.amendmentNumber,
      parsed_markdown: item.markdown,
      evidence_chunks: item.index.chunks,
      citation_document: submissionDocuments.find((document) =>
        document.index.documentSha256 === item.index.documentSha256
      )
    }));
    if (modelInput[0]) modelInput[0].submission_ledger = submissionLedger;
    let extraction: ExtractionCallResult;
    const modelStarted = performance.now();
    try {
      extraction = await model.extract(modelInput, paidExtractionCallbacks);
      const estimatedModelCost = extraction.inputTokens === null || extraction.outputTokens === null
        ? config.OPENAI_RUN_RESERVE_MICRO_USD
        : estimateOpenAiCostMicroUsd(extraction.inputTokens, extraction.outputTokens);
      if (usesDurableOpenAiLedger) {
        const billed = await store.get(runId);
        const batchCosts = billed?.costs.filter((event) =>
          event.provider === "openai" && event.attempt_id !== null &&
          event.attempt_id !== undefined && startedOpenAiAttempts.has(event.attempt_id)
        ) ?? [];
        if (
          startedOpenAiAttempts.size < 1 ||
          batchCosts.length !== startedOpenAiAttempts.size ||
          batchCosts.some((event) => event.status === "pending")
        ) {
          throw new AppError(
            "ANALYSIS_INCOMPLETE",
            "OpenAI returned before every paid batch cost was durably settled.",
            { httpStatus: 503, retryable: false }
          );
        }
        costs.push(...batchCosts);
      } else {
        costs.push({
          provider: "openai",
          operation: live ? "responses.parse.structured_extraction" : "local_deterministic_extraction",
          status: "succeeded",
          actual_micro_usd: live ? null : 0,
          estimated_micro_usd: live ? estimatedModelCost : null,
          latency_ms: extraction.latencyMs,
          retry_of: null
        });
      }
    } catch (error) {
      const attemptedBatchCost = error instanceof ModelBatchError
        ? estimateOpenAiBatchFailureCostMicroUsd(error)
        : null;
      if (error instanceof ModelBatchError) {
        auditLog("openai_partial_batch_failure", {
          failure_kind: error.failureKind,
          failure_phase: "structured_extraction",
          planned_batches: error.preflightInputTokens.length,
          completed_batches: error.completedBatches,
          attempted_batches: error.attemptedBatches,
          estimated_attempted_micro_usd: attemptedBatchCost
        });
      }
      if (usesDurableOpenAiLedger && startedOpenAiAttempts.size > 0) {
        const billed = await store.get(runId);
        costs.push(...(billed?.costs.filter((event) =>
          event.provider === "openai" && event.attempt_id !== null &&
          event.attempt_id !== undefined && startedOpenAiAttempts.has(event.attempt_id)
        ) ?? []));
      } else if (!usesDurableOpenAiLedger) {
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
      }
      throw error;
    } finally {
      // `parsedTargets` releases the parser-owned strings, but modelInput holds
      // independent string references. Drop those references before any raw
      // cleanup receipt can unlock a public result.
      for (const document of modelInput) document.parsed_markdown = "";
      scrubSubmissionCandidateLedger(submissionLedger);
    }

    assertBeforeDeadline(workflowStarted + RESULT_COMMIT_DEADLINE_MS, "result-commit");

    await stage(store, runId, "reconciling", claim);
    const storageProvider = getPrivateStorageProvider(config);
    recordInfrastructureCosts();
    const recordAuthority = extraction.recordAuthority ??
      unresolvedRecordAuthority("missing_record_authority");
    const materialized = materializeAnalysis({
      draft: extraction.analysis,
      submissionAdjudication: extraction.submissionAdjudication,
      recordAuthority,
      documents: submissionDocuments,
      manifests: cleanedManifests,
      costs,
      storageProvider,
      generatedAt: now(),
      expiresAt: new Date(initial.expiresAt)
    });
    assertBeforeDeadline(workflowStarted + RESULT_COMMIT_DEADLINE_MS, "result-commit");

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
      }) && allCapturedSourceWatchdogsClean(record);
      const candidate: RunRecord = {
        ...record,
        cleanupReceipts,
        citationReceipts: cleanupConfirmed
          ? [...record.citationReceipts, ...materialized.receipts]
          : record.citationReceipts,
        costs,
        costMicroUsd: materialized.result.costs.total_micro_usd,
        // Keep the result dark until cost settlement and the final deadline
        // gate succeed. The result endpoint keys off this field, so persisting
        // it during `verifying` would create a brief fail-open release window.
        result: null,
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
    const finalStatus = terminalStatusForAnalysis(materialized.result);
    heartbeat.assertHealthy();
    await heartbeat.stop();
    assertBeforeDeadline(workflowStarted + RESULT_COMMIT_DEADLINE_MS, "final-ready-transition");
    // Settlement is a release gate, not post-READY bookkeeping. If observed
    // or conservatively estimated spend exceeds the reservation/cap, the
    // catch path withholds the result and trips the budget failure closed.
    await budget.settle(runId, updated.costMicroUsd, now());
    assertBeforeDeadline(workflowStarted + RESULT_COMMIT_DEADLINE_MS, "final-ready-transition");
    const recordAuthorityAudit = createRecordAuthorityAudit(recordAuthority, now());
    updated = await store.update(runId, (record) => ({
      ...transitionRun(record, finalStatus),
      result: materialized.result,
      recordAuthorityAudit,
      processingLeaseId: null,
      processingLeaseExpiresAt: null
    }), claim);
    return updated;
  } catch (error) {
    await heartbeat.stop({ suppressFailure: true });
    const appError = asAppError(error);
    // Failure-inclusive infrastructure allocations belong in the audit ledger
    // even when validation, staging, parsing, or extraction terminates early.
    recordInfrastructureCosts();
    auditLog("run_pipeline_failed", {
      run_id: runId,
      error_code: appError.code,
      error_name: error instanceof Error ? error.name : "unknown"
    });
    const recoveryAt = now();
    const recoveryRecord = await store.get(runId);
    const alreadyDeleted = new Set(
      recoveryRecord?.cleanupReceipts
        .filter((receipt) => receipt.status === "deleted")
        .map((receipt) => receipt.resourceId) ?? []
    );
    const pendingTargets = cleanupTargets.filter(
      (target) =>
        (target.controlScope !== "application" || !alreadyDeleted.has(target.resourceId)) &&
        (!recoveryRecord || sourceCleanupAuthorized(recoveryRecord, target.resourceId, recoveryAt))
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
      const sourceAccessStillOpen = record.sourceCleanupWatchdogs.some((watchdog) =>
        watchdog.providerCallStartedAt !== null &&
        watchdog.providerResultCapturedAt === null &&
        watchdog.sourceAccessExpiresAt !== null &&
        new Date(watchdog.sourceAccessExpiresAt) > recoveryAt
      );
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
        processingLeaseExpiresAt: sourceAccessStillOpen
          ? record.processingLeaseExpiresAt
          : null,
        costs: mergeAttemptCosts(record.costs, costs),
        costMicroUsd: mergeAttemptCosts(record.costs, costs).reduce(
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
    const incurredCostMicroUsd = costs.reduce(
      (total, event) => total + (event.actual_micro_usd ?? event.estimated_micro_usd ?? 0),
      0
    );
    // A DELETE/expiry may revoke the run claim while a paid provider call is
    // in flight. The guarded run write must remain fenced, but its separate
    // budget reservation still has to retain at least the observed/estimated
    // spend so cancel-and-repeat cannot bypass the daily cap.
    // A failed live run keeps its full admission reservation. Infrastructure
    // estimates are failure-inclusive, while an interrupted provider request
    // may not have an invoice-grade receipt yet. Releasing that uncertainty as
    // zero would let repeated failures bypass the daily USD 20 circuit.
    const failureSettlementMicroUsd = live
      ? Math.max(failed.costMicroUsd, incurredCostMicroUsd, initial.reservedMicroUsd)
      : Math.max(failed.costMicroUsd, incurredCostMicroUsd);
    await budget.settle(runId, failureSettlementMicroUsd, now());
    return failed;
  }
}
