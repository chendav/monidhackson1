import type { RunStatus } from "@/contracts";
import { AppError } from "@/lib/errors";
import { STATUS_PROGRESS, type RunRecord } from "@/lib/runs/types";

const transitions: Record<RunStatus, ReadonlySet<RunStatus>> = {
  queued: new Set(["validating", "failed", "cleanup_pending", "expired"]),
  validating: new Set(["staging", "failed", "cleanup_pending", "expired"]),
  staging: new Set(["page_indexing", "failed", "cleanup_pending", "expired"]),
  page_indexing: new Set(["parsing", "failed", "cleanup_pending", "expired"]),
  parsing: new Set(["purging_source", "failed", "cleanup_pending", "expired"]),
  purging_source: new Set(["extracting", "cleanup_pending", "failed", "expired"]),
  extracting: new Set(["reconciling", "partial", "failed", "cleanup_pending", "expired"]),
  reconciling: new Set(["verifying", "partial", "failed", "cleanup_pending", "expired"]),
  verifying: new Set(["ready", "partial", "failed", "cleanup_pending", "expired"]),
  ready: new Set(["cleanup_pending", "expired"]),
  partial: new Set(["cleanup_pending", "expired"]),
  failed: new Set(["cleanup_pending", "expired"]),
  cleanup_pending: new Set(["failed", "expired"]),
  expired: new Set()
};

export function transitionRun(record: RunRecord, next: RunStatus, now = new Date()): RunRecord {
  if (record.status === next) return record;
  if (!transitions[record.status].has(next)) {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      `Invalid run transition: ${record.status} -> ${next}.`,
      { httpStatus: 409 }
    );
  }
  if ((next === "ready" || next === "partial") && !record.cleanupConfirmed) {
    throw new AppError(
      "SOURCE_CLEANUP_PENDING",
      "The run cannot complete until every application-controlled raw resource is deleted.",
      { httpStatus: 409, retryable: true }
    );
  }
  return {
    ...record,
    status: next,
    stage: next,
    progress: STATUS_PROGRESS[next],
    updatedAt: now.toISOString(),
    version: record.version + 1
  };
}
