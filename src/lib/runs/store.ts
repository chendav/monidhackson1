import type { CreateRunRequest } from "@/contracts";
import { getConfig } from "@/lib/config";
import { stableJson, sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import type { RunRecord } from "@/lib/runs/types";

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
  update(id: string, mutate: (record: RunRecord) => RunRecord): Promise<RunRecord>;
  remove(id: string): Promise<void>;
  listExpired(now?: Date): Promise<RunRecord[]>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function newRunRecord(input: CreateRunRecordInput): RunRecord {
  const now = input.now ?? new Date();
  const config = getConfig();
  return {
    id: input.id ?? crypto.randomUUID(),
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
    cleanupExpectedResourceIds: [],
    cleanupReceipts: [],
    citationReceipts: [],
    manifests: [],
    costs: [],
    costMicroUsd: 0,
    reservedMicroUsd: input.reservedMicroUsd,
    result: null,
    error: null,
    workflowRunId: null,
    version: 0,
    deletedAt: null
  };
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

  async update(id: string, mutate: (record: RunRecord) => RunRecord): Promise<RunRecord> {
    const current = this.records.get(id);
    if (!current) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
    }
    const next = mutate(clone(current));
    if (next.id !== current.id || next.ownerId !== current.ownerId) {
      throw new AppError("ANALYSIS_INCOMPLETE", "Immutable run identity fields were changed.", {
        httpStatus: 500
      });
    }
    this.records.set(id, clone(next));
    return clone(next);
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
  memoryStore ??= new InMemoryRunStore();
  return memoryStore;
}

export function resetInMemoryRunStoreForTests() {
  memoryStore?.clear();
  memoryStore = undefined;
  storeOverride = undefined;
}
