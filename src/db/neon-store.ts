import { neon } from "@neondatabase/serverless";
import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { runs } from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  newRunRecord,
  ACTIVE_RUN_STATUSES,
  CLEANUP_PENDING_MAINTENANCE_CADENCE_MS,
  CLEANUP_RETRY_DISPATCH_GRACE_MS,
  LEASED_RUN_STATUSES,
  PROCESSING_LEASE_MS,
  type CreateRunRecordInput,
  type RunStore
} from "@/lib/runs/store";
import type {
  AnalysisDispatchStatus,
  CleanupRetryDispatchStatus,
  RunRecord
} from "@/lib/runs/types";

export type RunRow = typeof runs.$inferSelect;

export function runRecordToRow(record: RunRecord): typeof runs.$inferInsert {
  return {
    id: record.id,
    ownerId: record.ownerId,
    quotaKey: record.quotaKey,
    input: record.input,
    requestHash: record.requestHash,
    idempotencyKey: record.idempotencyKey,
    status: record.status,
    stage: record.stage,
    progress: record.progress,
    cleanupConfirmed: record.cleanupConfirmed,
    cleanupExpectedResourceIds: record.cleanupExpectedResourceIds,
    cleanupReceipts: record.cleanupReceipts,
    sourceCleanupWatchdogs: record.sourceCleanupWatchdogs,
    paidProviderAttemptStartedAt: record.paidProviderAttemptStartedAt
      ? new Date(record.paidProviderAttemptStartedAt)
      : null,
    citationReceipts: record.citationReceipts,
    manifests: record.manifests,
    costs: record.costs,
    costMicroUsd: record.costMicroUsd,
    reservedMicroUsd: record.reservedMicroUsd,
    result: record.result,
    recordAuthorityAudit: record.recordAuthorityAudit,
    error: record.error,
    workflowRunId: record.workflowRunId,
    analysisDispatchClaimId: record.analysisDispatchClaimId,
    analysisDispatchClaimedAt: record.analysisDispatchClaimedAt
      ? new Date(record.analysisDispatchClaimedAt)
      : null,
    analysisDispatchStatus: record.analysisDispatchStatus,
    analysisDispatchUncertainAt: record.analysisDispatchUncertainAt
      ? new Date(record.analysisDispatchUncertainAt)
      : null,
    cleanupRetryClaimId: record.cleanupRetryClaimId,
    cleanupRetryClaimedAt: record.cleanupRetryClaimedAt
      ? new Date(record.cleanupRetryClaimedAt)
      : null,
    cleanupRetryWorkflowRunId: record.cleanupRetryWorkflowRunId,
    cleanupRetryDispatchStatus: record.cleanupRetryDispatchStatus,
    cleanupRetryDispatchUncertainAt: record.cleanupRetryDispatchUncertainAt
      ? new Date(record.cleanupRetryDispatchUncertainAt)
      : null,
    admissionLeaseId: record.admissionLeaseId,
    admissionLeaseExpiresAt: record.admissionLeaseExpiresAt
      ? new Date(record.admissionLeaseExpiresAt)
      : null,
    processingLeaseId: record.processingLeaseId,
    processingLeaseExpiresAt: record.processingLeaseExpiresAt
      ? new Date(record.processingLeaseExpiresAt)
      : null,
    processingFence: record.processingFence,
    terminalAfterCleanup: record.terminalAfterCleanup,
    auditExpiresAt: record.auditExpiresAt ? new Date(record.auditExpiresAt) : null,
    version: record.version,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    expiresAt: new Date(record.expiresAt),
    deletedAt: record.deletedAt ? new Date(record.deletedAt) : null
  };
}

export function runRowToRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    quotaKey: row.quotaKey,
    input: row.input,
    requestHash: row.requestHash,
    idempotencyKey: row.idempotencyKey,
    status: row.status as RunRecord["status"],
    stage: row.stage as RunRecord["stage"],
    progress: row.progress,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    cleanupConfirmed: row.cleanupConfirmed,
    cleanupExpectedResourceIds: row.cleanupExpectedResourceIds,
    cleanupReceipts: row.cleanupReceipts,
    sourceCleanupWatchdogs: row.sourceCleanupWatchdogs,
    paidProviderAttemptStartedAt: row.paidProviderAttemptStartedAt?.toISOString() ?? null,
    citationReceipts: row.citationReceipts,
    manifests: row.manifests,
    costs: row.costs,
    costMicroUsd: row.costMicroUsd,
    reservedMicroUsd: row.reservedMicroUsd,
    result: row.result,
    recordAuthorityAudit: row.recordAuthorityAudit,
    error: row.error,
    workflowRunId: row.workflowRunId,
    analysisDispatchClaimId: row.analysisDispatchClaimId,
    analysisDispatchClaimedAt: row.analysisDispatchClaimedAt?.toISOString() ?? null,
    analysisDispatchStatus: row.analysisDispatchStatus,
    analysisDispatchUncertainAt: row.analysisDispatchUncertainAt?.toISOString() ?? null,
    cleanupRetryClaimId: row.cleanupRetryClaimId,
    cleanupRetryClaimedAt: row.cleanupRetryClaimedAt?.toISOString() ?? null,
    cleanupRetryWorkflowRunId: row.cleanupRetryWorkflowRunId,
    cleanupRetryDispatchStatus: row.cleanupRetryDispatchStatus,
    cleanupRetryDispatchUncertainAt:
      row.cleanupRetryDispatchUncertainAt?.toISOString() ?? null,
    admissionLeaseId: row.admissionLeaseId,
    admissionLeaseExpiresAt: row.admissionLeaseExpiresAt?.toISOString() ?? null,
    processingLeaseId: row.processingLeaseId,
    processingLeaseExpiresAt: row.processingLeaseExpiresAt?.toISOString() ?? null,
    processingFence: row.processingFence,
    terminalAfterCleanup: row.terminalAfterCleanup as RunRecord["terminalAfterCleanup"],
    auditExpiresAt: row.auditExpiresAt?.toISOString() ?? null,
    version: row.version,
    deletedAt: row.deletedAt?.toISOString() ?? null
  };
}

export class NeonRunStore implements RunStore {
  private static readonly instances = new Map<string, NeonRunStore>();
  private readonly db;

  static forUrl(url: string) {
    let instance = this.instances.get(url);
    if (!instance) {
      instance = new NeonRunStore(url);
      this.instances.set(url, instance);
    }
    return instance;
  }

  constructor(url: string) {
    this.db = drizzle(neon(url), { schema: { runs } });
  }

  async create(input: CreateRunRecordInput): Promise<{ record: RunRecord; created: boolean }> {
    const candidate = newRunRecord(input);
    const inserted = await this.db
      .insert(runs)
      .values(runRecordToRow(candidate))
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return { record: runRowToRecord(inserted[0]), created: true };
    if (input.idempotencyKey) {
      const existing = await this.db.query.runs.findFirst({
        where: and(eq(runs.ownerId, input.ownerId), eq(runs.idempotencyKey, input.idempotencyKey))
      });
      if (existing) {
        const record = runRowToRecord(existing);
        if (record.requestHash !== candidate.requestHash) {
          throw new AppError(
            "ANALYSIS_INCOMPLETE",
            "The idempotency key was already used with a different request.",
            { httpStatus: 409 }
          );
        }
        return { record, created: false };
      }
    }
    const active = await this.db.query.runs.findFirst({
      where: and(
        eq(runs.ownerId, input.ownerId),
        inArray(runs.status, [...ACTIVE_RUN_STATUSES])
      )
    });
    if (active) {
      throw new AppError("RATE_LIMITED", "Only one analysis may be active at a time.", {
        httpStatus: 429,
        retryable: true
      });
    }
    throw new AppError("ANALYSIS_INCOMPLETE", "The run could not be created.", {
      httpStatus: 409,
      retryable: true
    });
  }

  async get(id: string): Promise<RunRecord | undefined> {
    const row = await this.db.query.runs.findFirst({ where: eq(runs.id, id) });
    return row ? runRowToRecord(row) : undefined;
  }

  async update(
    id: string,
    mutate: (record: RunRecord) => RunRecord,
    claim?: { leaseId: string; fence: number } | { admissionLeaseId: string }
  ): Promise<RunRecord> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.get(id);
      if (!current) {
        throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
      }
      const mutated = mutate(structuredClone(current));
      const next = { ...mutated, version: current.version + 1 };
      const guard = claim
        ? "admissionLeaseId" in claim
          ? and(
              eq(runs.id, id),
              eq(runs.version, current.version),
              eq(runs.admissionLeaseId, claim.admissionLeaseId)
            )
          : and(
              eq(runs.id, id),
              eq(runs.version, current.version),
              eq(runs.processingLeaseId, claim.leaseId),
              eq(runs.processingFence, claim.fence)
            )
        : and(eq(runs.id, id), eq(runs.version, current.version));
      const [updated] = await this.db
        .update(runs)
        .set(runRecordToRow(next))
        .where(guard)
        .returning();
      if (updated) return runRowToRecord(updated);
    }
    throw new AppError("ANALYSIS_INCOMPLETE", "The run was updated concurrently; retry the operation.", {
      httpStatus: 409,
      retryable: true
    });
  }

  async updateIfProcessingLeaseExpired(
    id: string,
    expiredAt: Date,
    mutate: (record: RunRecord) => RunRecord
  ): Promise<{ applied: boolean; record: RunRecord }> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.get(id);
      if (!current) {
        throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
      }
      if (
        (!(LEASED_RUN_STATUSES as readonly RunRecord["status"][]).includes(current.status) &&
          current.status !== "cleanup_pending") ||
        current.processingLeaseExpiresAt === null ||
        new Date(current.processingLeaseExpiresAt) > expiredAt
      ) {
        return { applied: false, record: current };
      }
      const mutated = mutate(structuredClone(current));
      const next = { ...mutated, version: current.version + 1 };
      const [updated] = await this.db
        .update(runs)
        .set(runRecordToRow(next))
        .where(and(
          eq(runs.id, id),
          eq(runs.version, current.version),
          inArray(runs.status, [...LEASED_RUN_STATUSES, "cleanup_pending"]),
          lte(runs.processingLeaseExpiresAt, expiredAt)
        ))
        .returning();
      if (updated) return { applied: true, record: runRowToRecord(updated) };
      // A heartbeat or terminal transition may have won after the stale read.
      // Re-read and return an explicit no-op rather than allowing callers to
      // infer success from fields that can legitimately be null.
    }
    throw new AppError("ANALYSIS_INCOMPLETE", "The run was updated concurrently; retry the operation.", {
      httpStatus: 409,
      retryable: true
    });
  }

  async claimAdmission(
    id: string,
    now = new Date(),
    leaseMs = 2 * 60_000
  ) {
    const admissionLeaseId = crypto.randomUUID();
    const [claimed] = await this.db
      .update(runs)
      .set({
        admissionLeaseId,
        admissionLeaseExpiresAt: new Date(now.getTime() + leaseMs),
        updatedAt: now,
        version: sql`${runs.version} + 1`
      })
      .where(and(
        eq(runs.id, id),
        eq(runs.status, "queued"),
        isNull(runs.workflowRunId),
        isNull(runs.analysisDispatchClaimId),
        or(isNull(runs.admissionLeaseId), lte(runs.admissionLeaseExpiresAt, now))
      ))
      .returning();
    if (!claimed) {
      const existing = await this.get(id);
      if (!existing) {
        throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
      }
      return null;
    }
    return { record: runRowToRecord(claimed), admissionLeaseId };
  }

  async claimProcessing(id: string, now = new Date(), leaseMs = PROCESSING_LEASE_MS) {
    const leaseId = crypto.randomUUID();
    const [claimed] = await this.db
      .update(runs)
      .set({
        status: "validating",
        stage: "validating",
        progress: 5,
        processingLeaseId: leaseId,
        processingLeaseExpiresAt: new Date(now.getTime() + leaseMs),
        processingFence: sql`${runs.processingFence} + 1`,
        updatedAt: now,
        version: sql`${runs.version} + 1`
      })
      .where(and(
        eq(runs.id, id),
        isNull(runs.paidProviderAttemptStartedAt),
        // An armed cleanup watchdog permanently transfers crash recovery to
        // maintenance. This atomic JSONB guard prevents a replacement worker
        // from scheduling a duplicate package watchdog after an ACK-lost
        // Workflow start but before the paid-provider marker is committed.
        sql`jsonb_array_length(${runs.sourceCleanupWatchdogs}) = 0`,
        or(
          eq(runs.status, "queued"),
          and(inArray(runs.status, [...LEASED_RUN_STATUSES]), lte(runs.processingLeaseExpiresAt, now))
        )
      ))
      .returning();
    if (!claimed) {
      const existing = await this.get(id);
      if (!existing) {
        throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
      }
      return null;
    }
    const record = runRowToRecord(claimed);
    return { record, leaseId, fence: record.processingFence };
  }

  async heartbeatProcessing(
    id: string,
    claim: { leaseId: string; fence: number },
    now = new Date(),
    leaseMs = PROCESSING_LEASE_MS
  ): Promise<RunRecord | null> {
    const [updated] = await this.db
      .update(runs)
      .set({
        processingLeaseExpiresAt: new Date(now.getTime() + leaseMs),
        updatedAt: now,
        version: sql`${runs.version} + 1`
      })
      .where(and(
        eq(runs.id, id),
        eq(runs.processingLeaseId, claim.leaseId),
        eq(runs.processingFence, claim.fence),
        inArray(runs.status, [...LEASED_RUN_STATUSES])
      ))
      .returning();
    return updated ? runRowToRecord(updated) : null;
  }

  async claimAnalysisDispatch(
    id: string,
    admissionLeaseId: string,
    now = new Date()
  ) {
    const analysisDispatchClaimId = crypto.randomUUID();
    const [claimed] = await this.db
      .update(runs)
      .set({
        analysisDispatchClaimId,
        analysisDispatchClaimedAt: now,
        analysisDispatchStatus: "dispatching",
        updatedAt: now,
        version: sql`${runs.version} + 1`
      })
      .where(and(
        eq(runs.id, id),
        eq(runs.status, "queued"),
        eq(runs.admissionLeaseId, admissionLeaseId),
        isNull(runs.analysisDispatchClaimId),
        isNull(runs.workflowRunId)
      ))
      .returning();
    if (!claimed) {
      const existing = await this.get(id);
      if (!existing) {
        throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
      }
      return null;
    }
    return { record: runRowToRecord(claimed), analysisDispatchClaimId };
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
    const [updated] = await this.db
      .update(runs)
      .set({
        workflowRunId: outcome.workflowRunId,
        analysisDispatchStatus: outcome.status,
        analysisDispatchUncertainAt: outcome.uncertainAt,
        admissionLeaseId: null,
        admissionLeaseExpiresAt: null,
        updatedAt: now,
        version: sql`${runs.version} + 1`
      })
      .where(and(
        eq(runs.id, id),
        eq(runs.analysisDispatchClaimId, analysisDispatchClaimId),
        eq(runs.analysisDispatchStatus, "dispatching")
      ))
      .returning();
    return updated ? runRowToRecord(updated) : null;
  }

  async claimCleanupRetry(id: string, now = new Date()) {
    const cleanupRetryClaimId = crypto.randomUUID();
    const [claimed] = await this.db
      .update(runs)
      .set({
        cleanupRetryClaimId,
        cleanupRetryClaimedAt: now,
        cleanupRetryDispatchStatus: "dispatching",
        updatedAt: now,
        version: sql`${runs.version} + 1`
      })
      .where(and(
        eq(runs.id, id),
        eq(runs.status, "cleanup_pending"),
        isNull(runs.cleanupRetryClaimId)
      ))
      .returning();
    if (!claimed) {
      const existing = await this.get(id);
      if (!existing) {
        throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
      }
      return null;
    }
    return { record: runRowToRecord(claimed), cleanupRetryClaimId };
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
    const [updated] = await this.db
      .update(runs)
      .set({
        cleanupRetryWorkflowRunId: outcome.workflowRunId,
        cleanupRetryDispatchStatus: outcome.status,
        cleanupRetryDispatchUncertainAt: outcome.uncertainAt,
        updatedAt: now,
        version: sql`${runs.version} + 1`
      })
      .where(and(
        eq(runs.id, id),
        eq(runs.cleanupRetryClaimId, cleanupRetryClaimId)
      ))
      .returning();
    return updated ? runRowToRecord(updated) : null;
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(runs).where(eq(runs.id, id));
  }

  async listExpired(now = new Date()): Promise<RunRecord[]> {
    const rows = await this.db.select().from(runs).where(lte(runs.expiresAt, now));
    return rows.map(runRowToRecord);
  }

  async listUnscheduledQueued(before: Date, limit = 20): Promise<RunRecord[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(
        eq(runs.status, "queued"),
        lte(runs.updatedAt, before)
      ))
      .orderBy(asc(runs.updatedAt), asc(runs.id))
      .limit(boundedLimit);
    return rows.map(runRowToRecord);
  }

  async listCleanupCandidates(now = new Date(), limit = 100): Promise<RunRecord[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 1_000);
    const orphanedDispatchBefore = new Date(now.getTime() - CLEANUP_RETRY_DISPATCH_GRACE_MS);
    const staleCleanupBefore = new Date(
      now.getTime() - CLEANUP_PENDING_MAINTENANCE_CADENCE_MS
    );
    const rows = await this.db
      .select()
      .from(runs)
      .where(or(
        and(ne(runs.status, "expired"), lte(runs.expiresAt, now)),
        and(
          eq(runs.status, "expired"),
          isNotNull(runs.auditExpiresAt),
          lte(runs.auditExpiresAt, now)
        ),
        and(
          inArray(runs.status, [...LEASED_RUN_STATUSES]),
          isNotNull(runs.processingLeaseExpiresAt),
          lte(runs.processingLeaseExpiresAt, now)
        ),
        and(
          eq(runs.status, "cleanup_pending"),
          isNotNull(runs.cleanupRetryDispatchUncertainAt),
          lte(runs.cleanupRetryDispatchUncertainAt, now)
        ),
        and(
          eq(runs.status, "cleanup_pending"),
          eq(runs.cleanupRetryDispatchStatus, "dispatching"),
          isNotNull(runs.cleanupRetryClaimedAt),
          lte(runs.cleanupRetryClaimedAt, orphanedDispatchBefore)
        ),
        and(
          eq(runs.status, "cleanup_pending"),
          lte(runs.updatedAt, staleCleanupBefore)
        )
      ))
      .orderBy(asc(runs.updatedAt), asc(runs.id))
      .limit(boundedLimit);
    return rows.map(runRowToRecord);
  }
}
