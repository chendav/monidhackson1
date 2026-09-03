import { neon } from "@neondatabase/serverless";
import { and, eq, inArray, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { runs } from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  newRunRecord,
  ACTIVE_RUN_STATUSES,
  type CreateRunRecordInput,
  type RunStore
} from "@/lib/runs/store";
import type { RunRecord } from "@/lib/runs/types";

type RunRow = typeof runs.$inferSelect;

function toRow(record: RunRecord): typeof runs.$inferInsert {
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
    citationReceipts: record.citationReceipts,
    manifests: record.manifests,
    costs: record.costs,
    costMicroUsd: record.costMicroUsd,
    reservedMicroUsd: record.reservedMicroUsd,
    result: record.result,
    error: record.error,
    workflowRunId: record.workflowRunId,
    version: record.version,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    expiresAt: new Date(record.expiresAt),
    deletedAt: record.deletedAt ? new Date(record.deletedAt) : null
  };
}

function fromRow(row: RunRow): RunRecord {
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
    citationReceipts: row.citationReceipts,
    manifests: row.manifests,
    costs: row.costs,
    costMicroUsd: row.costMicroUsd,
    reservedMicroUsd: row.reservedMicroUsd,
    result: row.result,
    error: row.error,
    workflowRunId: row.workflowRunId,
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
      .values(toRow(candidate))
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return { record: fromRow(inserted[0]), created: true };
    if (input.idempotencyKey) {
      const existing = await this.db.query.runs.findFirst({
        where: and(eq(runs.ownerId, input.ownerId), eq(runs.idempotencyKey, input.idempotencyKey))
      });
      if (existing) {
        const record = fromRow(existing);
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
    return row ? fromRow(row) : undefined;
  }

  async update(id: string, mutate: (record: RunRecord) => RunRecord): Promise<RunRecord> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.get(id);
      if (!current) {
        throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
      }
      const mutated = mutate(structuredClone(current));
      const next = { ...mutated, version: current.version + 1 };
      const [updated] = await this.db
        .update(runs)
        .set(toRow(next))
        .where(and(eq(runs.id, id), eq(runs.version, current.version)))
        .returning();
      if (updated) return fromRow(updated);
    }
    throw new AppError("ANALYSIS_INCOMPLETE", "The run was updated concurrently; retry the operation.", {
      httpStatus: 409,
      retryable: true
    });
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(runs).where(eq(runs.id, id));
  }

  async listExpired(now = new Date()): Promise<RunRecord[]> {
    const rows = await this.db.select().from(runs).where(lte(runs.expiresAt, now));
    return rows.map(fromRow);
  }
}
