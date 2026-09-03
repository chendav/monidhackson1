import type { CreateRunRequest } from "@/contracts";
import { getConfig } from "@/lib/config";
import { stableJson, sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import type {
  AnalysisDispatchStatus,
  CleanupRetryDispatchStatus,
  RunRecord
} from "@/lib/runs/types";

export const ACTIVE_RUN_STATUSES = [
  "queued",
  "validating",
  "staging",
  "page_indexing",
  "parsing",
  "purging_source",
  "extracting",
  "reconciling",
  "verifying",
  "cleanup_pending"
] as const satisfies readonly RunRecord["status"][];

export const LEASED_RUN_STATUSES = [
  "validating",
  "staging",
  "page_indexing",
  "parsing",
  "purging_source",
  "extracting",
  "reconciling",
  "verifying"
] as const satisfies readonly RunRecord["status"][];

// A hard-killed worker must become quiescent inside the one-minute source
// cleanup SLA. A live worker refreshes this lease while it owns the processing
// fence; a dead worker cannot.
export const PROCESSING_LEASE_MS = 45_000;
export const PROCESSING_HEARTBEAT_INTERVAL_MS = 10_000;
// Once this claim is committed, this product run may contact Workflow `start`
// at most once. An ACK-lost claim/start is terminally reconciled by recurring
// maintenance after the grace period; the claim is never cleared or reused.
export const ANALYSIS_DISPATCH_RECOVERY_GRACE_MS = 60_000;
// If the cleanup-claim UPDATE commits but its response is lost, the caller
// cannot safely dispatch. Maintenance treats the orphaned `dispatching` claim
// as due after this short grace without ever clearing it or starting a second
// standalone Workflow.
export const CLEANUP_RETRY_DISPATCH_GRACE_MS = 60_000;
export const CLEANUP_PENDING_MAINTENANCE_CADENCE_MS = 5 * 60_000;

export function isActiveRunStatus(status: RunRecord["status"]): boolean {
  return (ACTIVE_RUN_STATUSES as readonly RunRecord["status"][]).includes(status);
}

export interface CreateRunRecordInput {
  id?: string;
  ownerId: string;
  quotaKey: string;
  input: CreateRunRequest;
  idempotencyKey: string | null;
  reservedMicroUsd: number;
  now?: Date;
}

export interface RunStore {
  create(input: CreateRunRecordInput): Promise<{ record: RunRecord; created: boolean }>;
  get(id: string): Promise<RunRecord | undefined>;
  update(
    id: string,
    mutate: (record: RunRecord) => RunRecord,
    claim?: { leaseId: string; fence: number } | { admissionLeaseId: string }
  ): Promise<RunRecord>;
  updateIfProcessingLeaseExpired(
    id: string,
    expiredAt: Date,
    mutate: (record: RunRecord) => RunRecord
  ): Promise<{ applied: boolean; record: RunRecord }>;
  claimAdmission(
    id: string,
    now?: Date,
    leaseMs?: number
  ): Promise<{ record: RunRecord; admissionLeaseId: string } | null>;
  claimProcessing(
    id: string,
    now?: Date,
    leaseMs?: number
  ): Promise<{ record: RunRecord; leaseId: string; fence: number } | null>;
  heartbeatProcessing(
    id: string,
    claim: { leaseId: string; fence: number },
    now?: Date,
    leaseMs?: number
  ): Promise<RunRecord | null>;
  claimAnalysisDispatch(
    id: string,
    admissionLeaseId: string,
    now?: Date
  ): Promise<{ record: RunRecord; analysisDispatchClaimId: string } | null>;
  settleAnalysisDispatch(
    id: string,
    analysisDispatchClaimId: string,
    outcome: {
      status: Exclude<AnalysisDispatchStatus, "dispatching">;
      workflowRunId: string | null;
      uncertainAt: Date | null;
    },
    now?: Date
  ): Promise<RunRecord | null>;
  claimCleanupRetry(
    id: string,
    now?: Date
  ): Promise<{ record: RunRecord; cleanupRetryClaimId: string } | null>;
  settleCleanupRetryDispatch(
    id: string,
    cleanupRetryClaimId: string,
    outcome: {
      status: Exclude<CleanupRetryDispatchStatus, "dispatching">;
      workflowRunId: string | null;
      uncertainAt: Date | null;
    },
    now?: Date
  ): Promise<RunRecord | null>;
  remove(id: string): Promise<void>;
  listExpired(now?: Date): Promise<RunRecord[]>;
  listUnscheduledQueued(before: Date, limit?: number): Promise<RunRecord[]>;
  listCleanupCandidates(now?: Date, limit?: number): Promise<RunRecord[]>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function newRunRecord(input: CreateRunRecordInput): RunRecord {
  const now = input.now ?? new Date();
  const config = getConfig();
  const id = input.id ?? crypto.randomUUID();
  return {
    id,
    ownerId: input.ownerId,
    quotaKey: input.quotaKey,
    input: clone(input.input),
    requestHash: sha256Hex(stableJson(input.input)),
    idempotencyKey: input.idempotencyKey,
    status: "queued",
    stage: "queued",
    progress: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + config.RUN_TTL_HOURS * 3_600_000).toISOString(),
    cleanupConfirmed: false,
    cleanupExpectedResourceIds: input.input.documents.flatMap((document, index) => {
      const staged = `staged:${candidateStageId(id, index)}`;
      return document.source.type === "upload"
        ? [`blob:${document.source.blob_path}`, staged]
        : [staged];
    }),
    cleanupReceipts: [],
    sourceCleanupWatchdogs: [],
    paidProviderAttemptStartedAt: null,
    citationReceipts: [],
    manifests: [],
    costs: [],
    costMicroUsd: 0,
    reservedMicroUsd: input.reservedMicroUsd,
    result: null,
    error: null,
    workflowRunId: null,
    analysisDispatchClaimId: null,
    analysisDispatchClaimedAt: null,
    analysisDispatchStatus: null,
    analysisDispatchUncertainAt: null,
    cleanupRetryClaimId: null,
    cleanupRetryClaimedAt: null,
    cleanupRetryWorkflowRunId: null,
    cleanupRetryDispatchStatus: null,
    cleanupRetryDispatchUncertainAt: null,
    admissionLeaseId: null,
    admissionLeaseExpiresAt: null,
    processingLeaseId: null,
    processingLeaseExpiresAt: null,
    processingFence: 0,
    terminalAfterCleanup: null,
    auditExpiresAt: null,
    version: 0,
    deletedAt: null
  };
}

export function candidateStageId(runId: string, documentIndex: number) {
  return `${runId}:${documentIndex}`;
}

export class InMemoryRunStore implements RunStore {
  private readonly records = new Map<string, RunRecord>();
  private readonly idempotency = new Map<string, string>();

  async create(input: CreateRunRecordInput): Promise<{ record: RunRecord; created: boolean }> {
    const candidate = newRunRecord(input);
    if (input.idempotencyKey) {
      const key = `${input.ownerId}\u0000${input.idempotencyKey}`;
      const existingId = this.idempotency.get(key);
      if (existingId) {
        const existing = this.records.get(existingId);
        if (existing && existing.requestHash !== candidate.requestHash) {
          throw new AppError(
            "ANALYSIS_INCOMPLETE",
            "The idempotency key was already used with a different request.",
            { httpStatus: 409 }
          );
        }
        if (existing) return { record: clone(existing), created: false };
      }
    }
    const active = [...this.records.values()].find(
      (record) => record.ownerId === input.ownerId && isActiveRunStatus(record.status)
    );
    if (active) {
      throw new AppError("RATE_LIMITED", "Only one analysis may be active at a time.", {
        httpStatus: 429,
        retryable: true
      });
    }
    if (input.idempotencyKey) {
      this.idempotency.set(`${input.ownerId}\u0000${input.idempotencyKey}`, candidate.id);
    }
    this.records.set(candidate.id, candidate);
    return { record: clone(candidate), created: true };
  }

  async get(id: string): Promise<RunRecord | undefined> {
    const record = this.records.get(id);
    return record ? clone(record) : undefined;
  }

  async update(
    id: string,
    mutate: (record: RunRecord) => RunRecord,
    claim?: { leaseId: string; fence: number } | { admissionLeaseId: string }
  ): Promise<RunRecord> {
    const current = this.records.get(id);
    if (!current) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
    }
    const staleClaim = claim && ("admissionLeaseId" in claim
      ? current.admissionLeaseId !== claim.admissionLeaseId
      : current.processingLeaseId !== claim.leaseId || current.processingFence !== claim.fence);
    if (staleClaim) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The run lease is no longer current.", {
        httpStatus: 409,
        retryable: false
      });
    }
    const next = mutate(clone(current));
    if (next.id !== current.id || next.ownerId !== current.ownerId) {
      throw new AppError("ANALYSIS_INCOMPLETE", "Immutable run identity fields were changed.", {
        httpStatus: 500
      });
    }
    if (current.idempotencyKey && next.idempotencyKey === null) {
      this.idempotency.delete(`${current.ownerId}\u0000${current.idempotencyKey}`);
    }
    this.records.set(id, clone(next));
    return clone(next);
  }

  async updateIfProcessingLeaseExpired(
    id: string,
    expiredAt: Date,
    mutate: (record: RunRecord) => RunRecord
  ): Promise<{ applied: boolean; record: RunRecord }> {
    const current = this.records.get(id);
    if (!current) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
    }
    if (
      (!(LEASED_RUN_STATUSES as readonly RunRecord["status"][]).includes(current.status) &&
        current.status !== "cleanup_pending") ||
      current.processingLeaseExpiresAt === null ||
      new Date(current.processingLeaseExpiresAt) > expiredAt
    ) {
      return { applied: false, record: clone(current) };
    }
    const next = mutate(clone(current));
    if (next.id !== current.id || next.ownerId !== current.ownerId) {
      throw new AppError("ANALYSIS_INCOMPLETE", "Immutable run identity fields were changed.", {
        httpStatus: 500
      });
    }
    if (current.idempotencyKey && next.idempotencyKey === null) {
      this.idempotency.delete(`${current.ownerId}\u0000${current.idempotencyKey}`);
    }
    this.records.set(id, clone(next));
    return { applied: true, record: clone(next) };
  }

  async claimAdmission(
    id: string,
    now = new Date(),
    leaseMs = 2 * 60_000
  ) {
    const current = this.records.get(id);
    if (!current) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
    }
    const leaseAvailable = current.admissionLeaseId === null ||
      (current.admissionLeaseExpiresAt !== null && new Date(current.admissionLeaseExpiresAt) <= now);
    const schedulingAllowed = current.workflowRunId === null &&
      current.analysisDispatchClaimId === null;
    if (current.status !== "queued" || !leaseAvailable || !schedulingAllowed) return null;
    const admissionLeaseId = crypto.randomUUID();
    const record: RunRecord = {
      ...current,
      admissionLeaseId,
      admissionLeaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      updatedAt: now.toISOString(),
      version: current.version + 1
    };
    this.records.set(id, clone(record));
    return { record: clone(record), admissionLeaseId };
  }

  async claimProcessing(id: string, now = new Date(), leaseMs = PROCESSING_LEASE_MS) {
    const current = this.records.get(id);
    if (!current) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
    }
    const leaseExpired = current.processingLeaseExpiresAt !== null &&
      new Date(current.processingLeaseExpiresAt) <= now;
    const reclaimable =
      (LEASED_RUN_STATUSES as readonly RunRecord["status"][]).includes(current.status) &&
      leaseExpired;
    // Once source-cleanup recovery has been armed, restarting the whole
    // pipeline could schedule a second package watchdog if the first
    // Workflow acknowledgement was lost. Maintenance owns recovery from this
    // point forward, even when no paid-provider start marker was committed.
    if (
      current.sourceCleanupWatchdogs.length > 0 ||
      current.paidProviderAttemptStartedAt !== null
    ) return null;
    if (current.status !== "queued" && !reclaimable) return null;
    if (["ready", "partial", "failed", "expired"].includes(current.status)) return null;
    const leaseId = crypto.randomUUID();
    const fence = current.processingFence + 1;
    const record: RunRecord = {
      ...current,
      status: "validating",
      stage: "validating",
      progress: 5,
      processingLeaseId: leaseId,
      processingLeaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      processingFence: fence,
      updatedAt: now.toISOString(),
      version: current.version + 1
    };
    this.records.set(id, clone(record));
    return { record: clone(record), leaseId, fence };
  }

  async heartbeatProcessing(
    id: string,
    claim: { leaseId: string; fence: number },
    now = new Date(),
    leaseMs = PROCESSING_LEASE_MS
  ): Promise<RunRecord | null> {
    const current = this.records.get(id);
    if (!current) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
    }
    if (
      current.processingLeaseId !== claim.leaseId ||
      current.processingFence !== claim.fence ||
      !(LEASED_RUN_STATUSES as readonly RunRecord["status"][]).includes(current.status)
    ) return null;
    const record: RunRecord = {
      ...current,
      processingLeaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      updatedAt: now.toISOString(),
      version: current.version + 1
    };
    this.records.set(id, clone(record));
    return clone(record);
  }

  async claimAnalysisDispatch(
    id: string,
    admissionLeaseId: string,
    now = new Date()
  ) {
    const current = this.records.get(id);
    if (!current) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
    }
    if (
      current.status !== "queued" ||
      current.admissionLeaseId !== admissionLeaseId ||
      current.analysisDispatchClaimId !== null ||
      current.workflowRunId !== null
    ) return null;
    const analysisDispatchClaimId = crypto.randomUUID();
    const record: RunRecord = {
      ...current,
      analysisDispatchClaimId,
      analysisDispatchClaimedAt: now.toISOString(),
      analysisDispatchStatus: "dispatching",
      updatedAt: now.toISOString(),
      version: current.version + 1
    };
    this.records.set(id, clone(record));
    return { record: clone(record), analysisDispatchClaimId };
  }

  async settleAnalysisDispatch(
    id: string,
    analysisDispatchClaimId: string,
    outcome: {
      status: Exclude<AnalysisDispatchStatus, "dispatching">;
      workflowRunId: string | null;
      uncertainAt: Date | null;
    },
    now = new Date()
  ): Promise<RunRecord | null> {
    const current = this.records.get(id);
    if (!current) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
    }
    if (
      current.analysisDispatchClaimId !== analysisDispatchClaimId ||
      current.analysisDispatchStatus !== "dispatching"
    ) return null;
    const record: RunRecord = {
      ...current,
      workflowRunId: outcome.workflowRunId,
      analysisDispatchStatus: outcome.status,
      analysisDispatchUncertainAt: outcome.uncertainAt?.toISOString() ?? null,
      admissionLeaseId: null,
      admissionLeaseExpiresAt: null,
      updatedAt: now.toISOString(),
      version: current.version + 1
    };
    this.records.set(id, clone(record));
    return clone(record);
  }

  async claimCleanupRetry(id: string, now = new Date()) {
    const current = this.records.get(id);
    if (!current) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
    }
    if (current.status !== "cleanup_pending" || current.cleanupRetryClaimId !== null) {
      return null;
    }
    const cleanupRetryClaimId = crypto.randomUUID();
    const record: RunRecord = {
      ...current,
      cleanupRetryClaimId,
      cleanupRetryClaimedAt: now.toISOString(),
      cleanupRetryDispatchStatus: "dispatching",
      updatedAt: now.toISOString(),
      version: current.version + 1
    };
    this.records.set(id, clone(record));
    return { record: clone(record), cleanupRetryClaimId };
  }

  async settleCleanupRetryDispatch(
    id: string,
    cleanupRetryClaimId: string,
    outcome: {
      status: Exclude<CleanupRetryDispatchStatus, "dispatching">;
      workflowRunId: string | null;
      uncertainAt: Date | null;
    },
    now = new Date()
  ): Promise<RunRecord | null> {
    const current = this.records.get(id);
    if (!current) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
    }
    if (current.cleanupRetryClaimId !== cleanupRetryClaimId) return null;
    const record: RunRecord = {
      ...current,
      cleanupRetryWorkflowRunId: outcome.workflowRunId,
      cleanupRetryDispatchStatus: outcome.status,
      cleanupRetryDispatchUncertainAt: outcome.uncertainAt?.toISOString() ?? null,
      updatedAt: now.toISOString(),
      version: current.version + 1
    };
    this.records.set(id, clone(record));
    return clone(record);
  }

  async remove(id: string): Promise<void> {
    const record = this.records.get(id);
    if (record?.idempotencyKey) {
      this.idempotency.delete(`${record.ownerId}\u0000${record.idempotencyKey}`);
    }
    this.records.delete(id);
  }

  async listExpired(now = new Date()): Promise<RunRecord[]> {
    return [...this.records.values()]
      .filter((record) => new Date(record.expiresAt) <= now)
      .map(clone);
  }

  async listUnscheduledQueued(before: Date, limit = 20): Promise<RunRecord[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    return [...this.records.values()]
      .filter((record) =>
        record.status === "queued" && new Date(record.updatedAt) <= before
      )
      .sort((left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
        left.id.localeCompare(right.id)
      )
      .slice(0, boundedLimit)
      .map(clone);
  }

  async listCleanupCandidates(now = new Date(), limit = 100): Promise<RunRecord[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 1_000);
    const dueAt = (record: RunRecord) => {
      if (record.status === "expired") {
        return record.auditExpiresAt ? new Date(record.auditExpiresAt).getTime() : Number.POSITIVE_INFINITY;
      }
      const retentionDueAt = new Date(record.expiresAt).getTime();
      const cleanupCadenceDueAt = record.status === "cleanup_pending"
        ? new Date(record.updatedAt).getTime() + CLEANUP_PENDING_MAINTENANCE_CADENCE_MS
        : Number.POSITIVE_INFINITY;
      if (
        record.status === "cleanup_pending" &&
        record.cleanupRetryDispatchUncertainAt !== null
      ) {
        return Math.min(
          retentionDueAt,
          cleanupCadenceDueAt,
          new Date(record.cleanupRetryDispatchUncertainAt).getTime()
        );
      }
      if (
        record.status === "cleanup_pending" &&
        record.cleanupRetryDispatchStatus === "dispatching" &&
        record.cleanupRetryClaimedAt !== null
      ) {
        return Math.min(
          retentionDueAt,
          cleanupCadenceDueAt,
          new Date(record.cleanupRetryClaimedAt).getTime() + CLEANUP_RETRY_DISPATCH_GRACE_MS
        );
      }
      if (record.status === "cleanup_pending") {
        return Math.min(retentionDueAt, cleanupCadenceDueAt);
      }
      if (
        (LEASED_RUN_STATUSES as readonly RunRecord["status"][]).includes(record.status) &&
        record.processingLeaseExpiresAt !== null
      ) {
        return Math.min(retentionDueAt, new Date(record.processingLeaseExpiresAt).getTime());
      }
      return retentionDueAt;
    };
    return [...this.records.values()]
      .filter((record) => dueAt(record) <= now.getTime())
      .sort((left, right) => dueAt(left) - dueAt(right) || left.id.localeCompare(right.id))
      .slice(0, boundedLimit)
      .map(clone);
  }

  clear() {
    this.records.clear();
    this.idempotency.clear();
  }
}

let storeOverride: RunStore | undefined;
let memoryStore: InMemoryRunStore | undefined;

export function setRunStoreForTests(store: RunStore | undefined) {
  storeOverride = store;
}

export async function getRunStore(): Promise<RunStore> {
  if (storeOverride) return storeOverride;
  const config = getConfig();
  if (config.DATABASE_URL) {
    const { NeonRunStore } = await import("@/db/neon-store");
    return NeonRunStore.forUrl(config.DATABASE_URL);
  }
  if (config.NODE_ENV === "production") {
    throw new AppError("ANALYSIS_INCOMPLETE", "Persistent run storage is not configured.", {
      httpStatus: 503,
      retryable: true
    });
  }
  memoryStore ??= new InMemoryRunStore();
  return memoryStore;
}

export function resetInMemoryRunStoreForTests() {
  memoryStore?.clear();
  memoryStore = undefined;
  storeOverride = undefined;
}
