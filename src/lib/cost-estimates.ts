import type { CostEvent } from "@/contracts";
import type { PrivateStorageProvider } from "@/lib/config";
import {
  WORKFLOW_BASE_EVENT_ENVELOPE,
  WORKFLOW_BASE_FUNCTION_ATTEMPT_ENVELOPE,
  WORKFLOW_BASE_STEP_ATTEMPT_ENVELOPE,
  WORKFLOW_EVENTS_PER_DOCUMENT,
  WORKFLOW_FUNCTION_ATTEMPTS_PER_DOCUMENT,
  WORKFLOW_GENERATED_ROUTE_MAX_DURATION_SECONDS,
  WORKFLOW_STEP_ATTEMPTS_PER_DOCUMENT
} from "@/lib/workflow-cost-policy";

const MICRO_USD_PER_USD = 1_000_000;
const SECONDS_PER_HOUR = 3_600;
const MINUTES_PER_30_DAY_MONTH = 30 * 24 * 60;
const BYTES_PER_GIB = 1024 ** 3;
const BYTES_PER_GB = 1_000_000_000;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const PRICING_OBSERVED_AT = "2026-09-03T00:00:00.000Z";

// Conservative usage-equivalent estimates, not invoice claims. Included plan
// credits, shared monthly minimums, taxes, and provider aggregate rounding are
// excluded so the same formula remains reproducible per run.
const VERCEL_ACTIVE_CPU_USD_PER_HOUR = 0.221;
const VERCEL_MEMORY_USD_PER_GIB_HOUR = 0.0183;
const VERCEL_ASSUMED_MEMORY_GIB = 4;
const VERCEL_INVOCATION_USD = 0.60 / 1_000_000;
const VERCEL_WORKFLOW_EVENT_USD = 0.02 / 1_000;
const VERCEL_WORKFLOW_BYTES_WRITTEN_PER_EVENT = 64 * 1024;
const VERCEL_WORKFLOW_DATA_WRITTEN_USD_PER_GB = 0.50;
const VERCEL_WORKFLOW_POST_COMPLETION_RETENTION_DAYS = 7;
const VERCEL_WORKFLOW_DATA_RETAINED_USD_PER_GB_MONTH = 0.50;
// Workflows use Queues internally. Ten 4-KiB operations per lifecycle event
// covers all five published operation types plus the documented 2x unit case.
const VERCEL_QUEUE_OPERATIONS_PER_WORKFLOW_EVENT = 10;
const VERCEL_QUEUE_OPERATION_USD = 0.96 / 1_000_000;
const NEON_CU_USD_PER_HOUR = 0.222;
const NEON_AUTOSUSPEND_TAIL_MINUTES = 5;
const NEON_RESULT_STORAGE_GIB = 5 / 1024;
const NEON_RESULT_STORAGE_DAYS = 1;
const NEON_STORAGE_AND_HISTORY_USD_PER_GIB_MONTH = 0.35 + 0.20;
const RAILWAY_BUCKET_USD_PER_GIB_MONTH = 0.015;
const TEMP_STORAGE_MINUTES = 30;
const CONTINGENCY_MULTIPLIER = 1.25;

export const REQUIRED_INFRASTRUCTURE_COST_OPERATIONS = {
  vercel: [
    "fluid_compute_conservative_usage_allocation",
    "workflow_events_conservative_usage_allocation",
    "workflow_data_written_conservative_usage_allocation",
    "workflow_data_retained_conservative_usage_allocation",
    "workflow_queue_conservative_usage_allocation"
  ],
  neon: ["serverless_postgres_conservative_usage_allocation"],
  railway_s3: ["temporary_bucket_conservative_usage_allocation"]
} as const;

export function hasCompleteInfrastructureCostCoverage(
  costs: CostEvent[],
  provider: "vercel" | "neon" | "railway_s3"
) {
  const pricedOperations = new Set(costs.flatMap((event) =>
    event.provider === provider &&
      (event.actual_micro_usd !== null || event.estimated_micro_usd !== null)
      ? [event.operation]
      : []
  ));
  return REQUIRED_INFRASTRUCTURE_COST_OPERATIONS[provider].every((operation) =>
    pricedOperations.has(operation)
  );
}

function microUsdCeiling(usd: number) {
  return Math.max(1, Math.ceil(usd * MICRO_USD_PER_USD));
}

function workflowEventEnvelope(documentCount: number) {
  return WORKFLOW_BASE_EVENT_ENVELOPE +
    (WORKFLOW_EVENTS_PER_DOCUMENT * documentCount);
}

function workflowStepAttemptEnvelope(documentCount: number) {
  return WORKFLOW_BASE_STEP_ATTEMPT_ENVELOPE +
    (WORKFLOW_STEP_ATTEMPTS_PER_DOCUMENT * documentCount);
}

function workflowFunctionAttemptEnvelope(documentCount: number) {
  return WORKFLOW_BASE_FUNCTION_ATTEMPT_ENVELOPE +
    (WORKFLOW_FUNCTION_ATTEMPTS_PER_DOCUMENT * documentCount);
}

function estimateVercelComputeMicroUsd(documentCount: number) {
  // Price every generated flow-handler and step-handler attempt at the
  // attested route maximum, even though Fluid Compute does not charge active
  // CPU while awaiting I/O.
  const functionAttempts = workflowFunctionAttemptEnvelope(documentCount);
  const allocatedComputeSeconds = functionAttempts *
    WORKFLOW_GENERATED_ROUTE_MAX_DURATION_SECONDS;
  const invocationEnvelopes = workflowEventEnvelope(documentCount);
  const hourlyRate = VERCEL_ACTIVE_CPU_USD_PER_HOUR +
    (VERCEL_ASSUMED_MEMORY_GIB * VERCEL_MEMORY_USD_PER_GIB_HOUR);
  const computeUsd = allocatedComputeSeconds / SECONDS_PER_HOUR * hourlyRate;
  const invocationUsd = invocationEnvelopes * VERCEL_INVOCATION_USD;
  return microUsdCeiling((computeUsd + invocationUsd) * CONTINGENCY_MULTIPLIER);
}

function estimateWorkflowEventsMicroUsd(documentCount: number) {
  return microUsdCeiling(
    workflowEventEnvelope(documentCount) * VERCEL_WORKFLOW_EVENT_USD * CONTINGENCY_MULTIPLIER
  );
}

function estimateWorkflowDataWrittenMicroUsd(documentCount: number) {
  const writtenGb = workflowEventEnvelope(documentCount) *
    VERCEL_WORKFLOW_BYTES_WRITTEN_PER_EVENT / BYTES_PER_GB;
  return microUsdCeiling(
    writtenGb * VERCEL_WORKFLOW_DATA_WRITTEN_USD_PER_GB * CONTINGENCY_MULTIPLIER
  );
}

function workflowRetentionDays(runTtlHours: number) {
  return (runTtlHours / 24) + VERCEL_WORKFLOW_POST_COMPLETION_RETENTION_DAYS;
}

function estimateWorkflowDataRetainedMicroUsd(documentCount: number, runTtlHours: number) {
  const writtenGb = workflowEventEnvelope(documentCount) *
    VERCEL_WORKFLOW_BYTES_WRITTEN_PER_EVENT / BYTES_PER_GB;
  const retainedGbMonths = writtenGb * (workflowRetentionDays(runTtlHours) / 30);
  return microUsdCeiling(
    retainedGbMonths * VERCEL_WORKFLOW_DATA_RETAINED_USD_PER_GB_MONTH *
      CONTINGENCY_MULTIPLIER
  );
}

function estimateWorkflowQueueMicroUsd(documentCount: number) {
  const operations = workflowEventEnvelope(documentCount) *
    VERCEL_QUEUE_OPERATIONS_PER_WORKFLOW_EVENT;
  return microUsdCeiling(operations * VERCEL_QUEUE_OPERATION_USD * CONTINGENCY_MULTIPLIER);
}

function estimateNeonMicroUsd(documentCount: number, neonCostCuCeiling: number) {
  // The live endpoint setting is checked before a paid run. Cost the attested,
  // rounded-up CU ceiling for the bounded analysis, scale-to-zero tail, and
  // watchdog work, plus a small one-day result/history storage allocation.
  const activeMinutes = 5 + NEON_AUTOSUSPEND_TAIL_MINUTES + documentCount;
  const computeUsd = neonCostCuCeiling * activeMinutes / 60 * NEON_CU_USD_PER_HOUR;
  const storageUsd = NEON_RESULT_STORAGE_GIB * (NEON_RESULT_STORAGE_DAYS / 30) *
    NEON_STORAGE_AND_HISTORY_USD_PER_GIB_MONTH;
  return microUsdCeiling((computeUsd + storageUsd) * CONTINGENCY_MULTIPLIER);
}

function estimateRailwayBucketMicroUsd(documentCount: number) {
  const maximumSourceBytes = documentCount * MAX_DOCUMENT_BYTES;
  const gibMonths = maximumSourceBytes / BYTES_PER_GIB *
    (TEMP_STORAGE_MINUTES / MINUTES_PER_30_DAY_MONTH);
  return microUsdCeiling(gibMonths * RAILWAY_BUCKET_USD_PER_GIB_MONTH * CONTINGENCY_MULTIPLIER);
}

function estimatedEvent(input: {
  provider: CostEvent["provider"];
  operation: string;
  estimatedMicroUsd: number;
  observedPipelineLatencyMs: number;
  estimationBasis: string;
  pricingSourceUrl: string;
}): CostEvent {
  return {
    provider: input.provider,
    operation: input.operation,
    status: "succeeded",
    actual_micro_usd: null,
    estimated_micro_usd: input.estimatedMicroUsd,
    latency_ms: input.observedPipelineLatencyMs,
    retry_of: null,
    cost_provenance: null,
    estimation_basis: input.estimationBasis,
    pricing_source_url: input.pricingSourceUrl,
    pricing_observed_at: PRICING_OBSERVED_AT
  };
}

export interface InfrastructureCostEstimateInput {
  documentCount: number;
  storageProvider: PrivateStorageProvider;
  neonCostCuCeiling: number;
  runTtlHours: number;
  observedPipelineLatencyMs?: number;
}

export function buildInfrastructureCostEstimateEvents(
  input: InfrastructureCostEstimateInput
): CostEvent[] {
  if (!Number.isInteger(input.documentCount) || input.documentCount < 1 || input.documentCount > 5) {
    throw new Error("Infrastructure cost estimates require one to five documents.");
  }
  if (!Number.isFinite(input.neonCostCuCeiling) || input.neonCostCuCeiling <= 0 ||
    input.neonCostCuCeiling > 56) {
    throw new Error("Infrastructure cost estimates require a valid Neon CU ceiling.");
  }
  if (!Number.isInteger(input.runTtlHours) || input.runTtlHours < 1 || input.runTtlHours > 168) {
    throw new Error("Infrastructure cost estimates require a one-to-168-hour run TTL.");
  }
  const latencyMs = Math.max(0, Math.round(input.observedPipelineLatencyMs ?? 0));
  const events: CostEvent[] = [
    estimatedEvent({
      provider: "vercel",
      operation: "fluid_compute_conservative_usage_allocation",
      estimatedMicroUsd: estimateVercelComputeMicroUsd(input.documentCount),
      observedPipelineLatencyMs: latencyMs,
      estimationBasis: `${workflowFunctionAttemptEnvelope(input.documentCount)} generated Workflow function attempts (${workflowStepAttemptEnvelope(input.documentCount)} step handlers plus ${workflowFunctionAttemptEnvelope(input.documentCount) - workflowStepAttemptEnvelope(input.documentCount)} flow handlers) x ${WORKFLOW_GENERATED_ROUTE_MAX_DURATION_SECONDS}s, all at the highest published regional 1-vCPU + 4-GiB rate, plus a failure-inclusive allocation of ${workflowEventEnvelope(input.documentCount)} invocations and 25% contingency. This prices every code-bounded attempt at its maximum; plan credits excluded.`,
      pricingSourceUrl: "https://vercel.com/docs/functions/usage-and-pricing"
    }),
    estimatedEvent({
      provider: "vercel",
      operation: "workflow_events_conservative_usage_allocation",
      estimatedMicroUsd: estimateWorkflowEventsMicroUsd(input.documentCount),
      observedPipelineLatencyMs: latencyMs,
      estimationBasis: `${workflowEventEnvelope(input.documentCount)} lifecycle events: ${WORKFLOW_BASE_EVENT_ENVELOPE} base events plus ${input.documentCount} x ${WORKFLOW_EVENTS_PER_DOCUMENT} per-document events, at $0.02/1K, plus 25% contingency; package watchdogs are included in the base and upload sweeping is maintenance-owned; plan allowances excluded.`,
      pricingSourceUrl: "https://vercel.com/docs/workflows/pricing"
    }),
    estimatedEvent({
      provider: "vercel",
      operation: "workflow_data_written_conservative_usage_allocation",
      estimatedMicroUsd: estimateWorkflowDataWrittenMicroUsd(input.documentCount),
      observedPipelineLatencyMs: latencyMs,
      estimationBasis: `${workflowEventEnvelope(input.documentCount)} lifecycle events x 64 KiB written allocation at $0.50/GB, plus 25% contingency; raw documents and parser text are excluded from Workflow state by design.`,
      pricingSourceUrl: "https://vercel.com/docs/workflows/pricing"
    }),
    estimatedEvent({
      provider: "vercel",
      operation: "workflow_data_retained_conservative_usage_allocation",
      estimatedMicroUsd: estimateWorkflowDataRetainedMicroUsd(
        input.documentCount,
        input.runTtlHours
      ),
      observedPipelineLatencyMs: latencyMs,
      estimationBasis: `${workflowEventEnvelope(input.documentCount)} lifecycle events x 64 KiB retained for ${workflowRetentionDays(input.runTtlHours)} days (${input.runTtlHours}-hour run lifetime plus seven-day Pro post-completion retention) at $0.50/GB-month, plus 25% contingency.`,
      pricingSourceUrl: "https://vercel.com/docs/workflows/pricing"
    }),
    estimatedEvent({
      provider: "vercel",
      operation: "workflow_queue_conservative_usage_allocation",
      estimatedMicroUsd: estimateWorkflowQueueMicroUsd(input.documentCount),
      observedPipelineLatencyMs: latencyMs,
      estimationBasis: `${workflowEventEnvelope(input.documentCount)} lifecycle events x a conservative allocation of 10 single-chunk Queue operation units/event at the highest published $0.96/M regional rate, plus 25% contingency. Vercel does not publish the internal Workflow-to-Queue operation mapping, so live usage receipts must calibrate this allocation; plan allowances excluded.`,
      pricingSourceUrl: "https://vercel.com/docs/pricing/regional-pricing"
    }),
    estimatedEvent({
      provider: "neon",
      operation: "serverless_postgres_conservative_usage_allocation",
      estimatedMicroUsd: estimateNeonMicroUsd(
        input.documentCount,
        input.neonCostCuCeiling
      ),
      observedPipelineLatencyMs: latencyMs,
      estimationBasis: `${input.neonCostCuCeiling} CU live-attested cost ceiling for ${10 + input.documentCount} minutes plus 5 MiB of result/history storage for one day, at published Scale rates, plus 25% contingency; plan credits excluded.`,
      pricingSourceUrl: "https://neon.com/pricing"
    })
  ];

  if (input.storageProvider === "railway_s3") {
    events.push(estimatedEvent({
      provider: "railway_s3",
      operation: "temporary_bucket_conservative_usage_allocation",
      estimatedMicroUsd: estimateRailwayBucketMicroUsd(input.documentCount),
      observedPipelineLatencyMs: latencyMs,
      estimationBasis: `${input.documentCount} x 25-MiB maximum sources retained for 30 minutes at $0.015/GiB-month, plus 25% contingency; free operations/egress and aggregate monthly rounding excluded. Shared Railway/GitHub maintenance-trigger overhead and subscription minimums are reported separately, not treated as per-run storage cost.`,
      pricingSourceUrl: "https://docs.railway.com/storage-buckets/billing"
    }));
  }

  return events;
}

export function infrastructureCostCommitmentMicroUsd(
  input: Omit<InfrastructureCostEstimateInput, "observedPipelineLatencyMs">
) {
  return buildInfrastructureCostEstimateEvents(input).reduce(
    (total, event) => total + (event.estimated_micro_usd ?? 0),
    0
  );
}
