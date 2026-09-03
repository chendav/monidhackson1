import type {
  AnalysisResult,
  CostEvent,
  CreateRunRequest,
  DocumentManifest,
  ErrorCode,
  RunStatus,
  RunStatusResponse
} from "@/contracts";
import type { QuoteVerificationReceipt } from "@/lib/evidence/citations";

export type CleanupControlScope = "application" | "provider";
export type CleanupReceiptStatus = "deleted" | "failed" | "unknown";

export interface CleanupReceipt {
  receiptId: string;
  resourceId: string;
  resourceKind: "source_blob" | "staged_source" | "page_text" | "parsed_markdown" | "provider_artifact";
  controlScope: CleanupControlScope;
  status: CleanupReceiptStatus;
  attemptedAt: string;
  confirmedAt: string | null;
  detail: string;
}

export type SourceCleanupWatchdogStatus =
  | "armed"
  | "provider_call_started"
  | "captured"
  | "cleanup_pending"
  | "cleanup_confirmed"
  | "cancelled";

export type CleanupRetryDispatchStatus =
  | "dispatching"
  | "scheduled"
  | "not_dispatched"
  | "dispatch_uncertain";

export type AnalysisDispatchStatus = CleanupRetryDispatchStatus;

/**
 * Durable, deliberately sanitized state for one paid parse attempt. Resource
 * identifiers are opaque application storage keys only; provider payloads,
 * source URLs, filenames, Markdown, and evidence text must never be written
 * here.
 */
export interface SourceCleanupWatchdog {
  registrationId: string;
  documentIndex: number;
  documentId: string;
  resourceIds: string[];
  status: SourceCleanupWatchdogStatus;
  registeredAt: string;
  watchdogScheduledAt: string | null;
  watchdogWorkflowRunId: string | null;
  providerCallStartedAt: string | null;
  sourceAccessExpiresAt: string | null;
  providerResultCapturedAt: string | null;
  providerResultIdSha256: string | null;
  cleanupLastAttemptAt: string | null;
  cleanupConfirmedAt: string | null;
  cleanupAttempts: number;
  cancelledAt: string | null;
}

export interface RunFailure {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  request_id: string;
}

export interface RunRecord {
  id: string;
  ownerId: string;
  quotaKey: string;
  input: CreateRunRequest | null;
  requestHash: string | null;
  idempotencyKey: string | null;
  status: RunStatus;
  stage: RunStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  cleanupConfirmed: boolean;
  cleanupExpectedResourceIds: string[];
  cleanupReceipts: CleanupReceipt[];
  sourceCleanupWatchdogs: SourceCleanupWatchdog[];
  paidProviderAttemptStartedAt: string | null;
  citationReceipts: QuoteVerificationReceipt[];
  manifests: DocumentManifest[];
  costs: CostEvent[];
  costMicroUsd: number;
  reservedMicroUsd: number;
  result: AnalysisResult | null;
  error: RunFailure | null;
  workflowRunId: string | null;
  analysisDispatchClaimId: string | null;
  analysisDispatchClaimedAt: string | null;
  analysisDispatchStatus: AnalysisDispatchStatus | null;
  analysisDispatchUncertainAt: string | null;
  cleanupRetryClaimId: string | null;
  cleanupRetryClaimedAt: string | null;
  cleanupRetryWorkflowRunId: string | null;
  cleanupRetryDispatchStatus: CleanupRetryDispatchStatus | null;
  cleanupRetryDispatchUncertainAt: string | null;
  admissionLeaseId: string | null;
  admissionLeaseExpiresAt: string | null;
  processingLeaseId: string | null;
  processingLeaseExpiresAt: string | null;
  processingFence: number;
  terminalAfterCleanup: "failed" | "expired" | null;
  auditExpiresAt: string | null;
  version: number;
  deletedAt: string | null;
}

export const STATUS_PROGRESS: Record<RunStatus, number> = {
  queued: 0,
  validating: 5,
  staging: 12,
  page_indexing: 24,
  parsing: 38,
  purging_source: 50,
  extracting: 62,
  reconciling: 76,
  verifying: 88,
  ready: 100,
  partial: 100,
  failed: 100,
  cleanup_pending: 96,
  expired: 100
};

export function toRunStatusResponse(record: RunRecord): RunStatusResponse {
  const costAccountingStatus = record.paidProviderAttemptStartedAt === null
    ? "no_paid_attempt" as const
    : record.costs.some((event) => event.status === "pending")
      ? "estimated_pending" as const
      : record.costs.some((event) => event.actual_micro_usd === null)
        ? "estimated_complete" as const
        : "actual_complete" as const;
  return {
    run_id: record.id,
    status: record.status,
    stage: record.stage,
    progress: record.progress,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    expires_at: record.expiresAt,
    cleanup_confirmed: record.cleanupConfirmed,
    cost_micro_usd: record.costMicroUsd,
    cost_accounting_status: costAccountingStatus,
    error: record.error
  };
}
