import { describe, expect, it, vi } from "vitest";
import { expireDueRuns } from "@/lib/runs/expiry";
import { scheduleCleanupRetry } from "@/lib/runs/scheduler";
import { transitionRun } from "@/lib/runs/state-machine";
import {
  CLEANUP_PENDING_MAINTENANCE_CADENCE_MS,
  CLEANUP_RETRY_DISPATCH_GRACE_MS,
  InMemoryRunStore,
  type RunStore
} from "@/lib/runs/store";
import { LocalUploadStorage } from "@/lib/storage/uploads";

async function createPendingRun(store: InMemoryRunStore) {
  const created = await store.create({
    ownerId: "guest:cleanup-retry",
    quotaKey: "ip:cleanup-retry",
    input: {
      documents: [{
        role: "base",
        source: { type: "url", url: "https://canadabuys.canada.ca/tender.pdf" }
      }]
    },
    idempotencyKey: null,
    reservedMicroUsd: 0,
    now: new Date("2026-09-03T18:00:00.000Z")
  });
  return store.update(created.record.id, (record) => ({
    ...transitionRun(record, "cleanup_pending", new Date("2026-09-03T18:01:00.000Z")),
    terminalAfterCleanup: "expired"
  }));
}

describe("standalone cleanup retry scheduling", () => {
  it("dispatches at most one Workflow under concurrent and repeated requests", async () => {
    const store = new InMemoryRunStore();
    const record = await createPendingRun(store);
    let releaseDispatch!: () => void;
    let dispatchStarted!: () => void;
    const started = new Promise<void>((resolve) => { dispatchStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseDispatch = resolve; });
    const dispatch = vi.fn(async () => {
      dispatchStarted();
      await blocked;
      return "cleanup-workflow-1";
    });
    const now = () => new Date("2026-09-03T18:02:00.000Z");

    const first = scheduleCleanupRetry(record.id, { store, dispatch, now });
    await started;
    const duplicates = Array.from({ length: 12 }, () =>
      scheduleCleanupRetry(record.id, { store, dispatch, now })
    );
    releaseDispatch();
    await Promise.all([first, ...duplicates]);

    await expect(scheduleCleanupRetry(record.id, { store, dispatch, now }))
      .resolves.toBe("cleanup-workflow-1");
    expect(dispatch).toHaveBeenCalledTimes(1);
    const persisted = await store.get(record.id);
    expect(persisted).toMatchObject({
      cleanupRetryClaimedAt: "2026-09-03T18:02:00.000Z",
      cleanupRetryWorkflowRunId: "cleanup-workflow-1",
      cleanupRetryDispatchStatus: "scheduled",
      cleanupRetryDispatchUncertainAt: null
    });
    expect(persisted?.cleanupRetryClaimId).not.toBeNull();
  });

  it("keeps the claim after an uncertain dispatch and delegates fallback to maintenance", async () => {
    const store = new InMemoryRunStore();
    const record = await createPendingRun(store);
    const dispatch = vi.fn(async () => {
      throw new Error("scheduler acknowledgement lost");
    });
    const now = () => new Date("2026-09-03T18:03:00.000Z");

    await expect(scheduleCleanupRetry(record.id, { store, dispatch, now }))
      .rejects.toMatchObject({
        code: "SOURCE_CLEANUP_PENDING",
        httpStatus: 503,
        retryable: true,
        message: expect.stringContaining("No second standalone retry")
      });
    await expect(scheduleCleanupRetry(record.id, { store, dispatch, now }))
      .resolves.toBeNull();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(await store.get(record.id)).toMatchObject({
      cleanupRetryWorkflowRunId: null,
      cleanupRetryDispatchStatus: "dispatch_uncertain",
      cleanupRetryDispatchUncertainAt: "2026-09-03T18:03:00.000Z"
    });
    expect((await store.listCleanupCandidates(now(), 100)).map((candidate) => candidate.id))
      .toContain(record.id);

    const fallback = await expireDueRuns(
      store,
      new LocalUploadStorage(),
      now()
    );
    expect(fallback).toHaveLength(1);
    expect((await store.get(record.id))?.status).toBe("expired");
    expect((await store.get(record.id))?.cleanupConfirmed).toBe(true);
  });

  it("hands a scheduled retry's long tail to five-minute maintenance", async () => {
    const store = new InMemoryRunStore();
    const record = await createPendingRun(store);
    const scheduledAt = new Date("2026-09-03T18:02:00.000Z");

    await expect(scheduleCleanupRetry(record.id, {
      store,
      dispatch: async () => "cleanup-workflow-bounded",
      now: () => scheduledAt
    })).resolves.toBe("cleanup-workflow-bounded");

    expect(await store.listCleanupCandidates(new Date(
      scheduledAt.getTime() + CLEANUP_PENDING_MAINTENANCE_CADENCE_MS - 1
    ), 100)).toEqual([]);
    expect((await store.listCleanupCandidates(new Date(
      scheduledAt.getTime() + CLEANUP_PENDING_MAINTENANCE_CADENCE_MS
    ), 100)).map((candidate) => candidate.id)).toContain(record.id);
    expect((await store.get(record.id))?.cleanupRetryDispatchStatus).toBe("scheduled");
  });

  it("recovers a committed claim whose database acknowledgement was lost", async () => {
    const store = new InMemoryRunStore();
    const record = await createPendingRun(store);
    const claimedAt = new Date("2026-09-03T18:04:00.000Z");
    const dispatch = vi.fn(async () => "must-not-run");
    const acknowledgementLossStore = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "claimCleanupRetry") {
          return async (id: string, now?: Date) => {
            await target.claimCleanupRetry(id, now);
            throw new Error("database acknowledgement lost");
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    }) as RunStore;

    await expect(scheduleCleanupRetry(record.id, {
      store: acknowledgementLossStore,
      dispatch,
      now: () => claimedAt
    })).rejects.toMatchObject({
      code: "SOURCE_CLEANUP_PENDING",
      message: expect.stringContaining("without a blind redispatch")
    });
    await expect(scheduleCleanupRetry(record.id, {
      store,
      dispatch,
      now: () => new Date(claimedAt.getTime() + CLEANUP_RETRY_DISPATCH_GRACE_MS)
    })).resolves.toBeNull();

    expect(dispatch).not.toHaveBeenCalled();
    expect(await store.get(record.id)).toMatchObject({
      cleanupRetryClaimedAt: claimedAt.toISOString(),
      cleanupRetryDispatchStatus: "dispatching",
      cleanupRetryDispatchUncertainAt: null
    });
    expect(await store.listCleanupCandidates(
      new Date(claimedAt.getTime() + CLEANUP_RETRY_DISPATCH_GRACE_MS - 1),
      100
    )).toEqual([]);
    expect((await store.listCleanupCandidates(
      new Date(claimedAt.getTime() + CLEANUP_RETRY_DISPATCH_GRACE_MS),
      100
    )).map((candidate) => candidate.id)).toContain(record.id);
  });

  it("does not claim or dispatch a run outside cleanup_pending", async () => {
    const store = new InMemoryRunStore();
    const created = await store.create({
      ownerId: "guest:no-cleanup",
      quotaKey: "ip:no-cleanup",
      input: {
        documents: [{
          role: "base",
          source: { type: "url", url: "https://canadabuys.canada.ca/tender.pdf" }
        }]
      },
      idempotencyKey: null,
      reservedMicroUsd: 0
    });
    const dispatch = vi.fn(async () => "must-not-run");

    await expect(scheduleCleanupRetry(created.record.id, { store, dispatch }))
      .resolves.toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
    expect((await store.get(created.record.id))?.cleanupRetryClaimId).toBeNull();
  });
});
