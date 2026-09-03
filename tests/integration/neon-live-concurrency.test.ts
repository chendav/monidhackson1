import { describe, expect, it } from "vitest";
import { NeonRunStore } from "@/db/neon-store";
import { getConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { transitionRun } from "@/lib/runs/state-machine";
import {
  CLEANUP_RETRY_DISPATCH_GRACE_MS,
  type CreateRunRecordInput
} from "@/lib/runs/store";
import { NeonBudgetGuard } from "@/lib/security/budget";

const LIVE_PROBE_ENABLED = process.env.NEON_LIVE_CONCURRENCY_PROBE === "true";

function oneShotBarrier(parties: number) {
  let arrivals = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    arrivals += 1;
    if (arrivals === parties) release();
    await released;
  };
}

class FirstReadBarrierNeonRunStore extends NeonRunStore {
  private firstRead = true;

  constructor(url: string, private readonly waitAtFirstRead: () => Promise<void>) {
    super(url);
  }

  override async get(id: string) {
    const record = await super.get(id);
    if (this.firstRead) {
      this.firstRead = false;
      await this.waitAtFirstRead();
    }
    return record;
  }
}

function sanitizedProbeFailure(error: unknown, databaseUrl: string) {
  const name = error instanceof Error ? error.name : "UnknownError";
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [databaseUrl, encodeURI(databaseUrl), encodeURIComponent(databaseUrl)]) {
    message = message.replaceAll(secret, "[redacted database URL]");
  }
  message = message.replace(/postgres(?:ql)?:\/\/[^\s\"']+/gi, "[redacted database URL]");
  return new Error(`Neon live concurrency probe failed (${name}): ${message.slice(0, 1_000)}`);
}

function runInput(
  ownerId: string,
  quotaKey: string,
  idempotencyKey: string
): CreateRunRecordInput {
  return {
    ownerId,
    quotaKey,
    input: {
      documents: [{
        role: "base",
        source: {
          type: "url",
          url: "https://canadabuys.canada.ca/live-concurrency-probe.pdf"
        }
      }]
    },
    idempotencyKey,
    reservedMicroUsd: 1_000_000
  };
}

describe.skipIf(!LIVE_PROBE_ENABLED)("Neon live concurrency contract", () => {
  it("serializes admission, processing claims, and the daily cost cap", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    expect(databaseUrl, "DATABASE_URL must be set for the explicit Neon live probe").toBeTruthy();

    let store: NeonRunStore | undefined;
    const namespace = `probe:${crypto.randomUUID()}`;
    const createdIds = new Set<string>();

    try {
      const config = getConfig({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        MAX_RUN_COST_MICRO_USD: "2000000",
        DAILY_COST_CAP_MICRO_USD: "20000000",
        API_RUNS_PER_DAY: "30"
      });
      store = new NeonRunStore(databaseUrl!);
      const activeStore = store;
      const budget = new NeonBudgetGuard(databaseUrl!, config);
      const idempotentCreates = await Promise.all(Array.from({ length: 8 }, () =>
        activeStore.create(runInput(`${namespace}:idem`, `${namespace}:idem-quota`, "same-request"))
      ));
      idempotentCreates.forEach(({ record }) => createdIds.add(record.id));
      expect(new Set(idempotentCreates.map(({ record }) => record.id)).size).toBe(1);
      expect(idempotentCreates.filter(({ created }) => created)).toHaveLength(1);

      const idempotentRunId = idempotentCreates[0].record.id;
      const processingClaims = await Promise.all(Array.from({ length: 8 }, () =>
        activeStore.claimProcessing(idempotentRunId)
      ));
      expect(processingClaims.filter(Boolean)).toHaveLength(1);

      const competingCreates = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
        activeStore.create(runInput(
          `${namespace}:active`,
          `${namespace}:active-quota`,
          `competing-${index}`
        ))
      ));
      const activeWinners = competingCreates.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<NeonRunStore["create"]>>> =>
          result.status === "fulfilled"
      );
      activeWinners.forEach(({ value }) => createdIds.add(value.record.id));
      expect(activeWinners).toHaveLength(1);
      expect(competingCreates.filter((result) => result.status === "rejected").every((result) =>
        result.status === "rejected" && result.reason instanceof AppError &&
        result.reason.code === "RATE_LIMITED"
      )).toBe(true);

      const budgetQuota = `${namespace}:budget-quota`;
      const budgetRuns = await Promise.all(Array.from({ length: 21 }, async (_, index) => {
        const created = await activeStore.create(runInput(
          `${namespace}:budget-owner-${index}`,
          budgetQuota,
          `budget-${index}`
        ));
        createdIds.add(created.record.id);
        return created.record;
      }));
      const reservations = await Promise.allSettled(budgetRuns.map((record) =>
        budget.reserve({
          runId: record.id,
          quotaKey: budgetQuota,
          principalKind: "api",
          amountMicroUsd: 1_000_000
        })
      ));
      expect(reservations.filter((result) => result.status === "fulfilled")).toHaveLength(20);
      expect(reservations.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(reservations.some((result) =>
        result.status === "rejected" && result.reason instanceof AppError &&
        result.reason.code === "BUDGET_EXCEEDED"
      )).toBe(true);
    } catch (error) {
      throw sanitizedProbeFailure(error, databaseUrl!);
    } finally {
      if (store) {
        const cleanupStore = store;
        await Promise.allSettled([...createdIds].map((id) => cleanupStore.remove(id)));
      }
    }
  }, 60_000);

  it("re-reads the winning record after a real expired-lease CAS loss", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    expect(databaseUrl, "DATABASE_URL must be set for the explicit Neon live probe").toBeTruthy();

    const namespace = `probe:${crypto.randomUUID()}`;
    const setupStore = new NeonRunStore(databaseUrl!);
    let runId: string | undefined;

    try {
      const claimedAt = new Date("2026-09-03T00:00:00.000Z");
      const expiredAt = new Date("2026-09-03T00:00:00.002Z");
      const created = await setupStore.create(runInput(
        `${namespace}:cas-owner`,
        `${namespace}:cas-quota`,
        "cleanup-cas-loss"
      ));
      runId = created.record.id;
      const claimed = await setupStore.claimProcessing(runId, claimedAt, 1);
      expect(claimed).not.toBeNull();

      // Both stores complete a real SELECT of the same expired version before
      // either conditional UPDATE is allowed to proceed. One UPDATE wins; the
      // loser must then execute the production re-read path and return the
      // winning record as an explicit no-op.
      const barrier = oneShotBarrier(2);
      const stores = [
        new FirstReadBarrierNeonRunStore(databaseUrl!, barrier),
        new FirstReadBarrierNeonRunStore(databaseUrl!, barrier)
      ];
      const mutateCalls = [0, 0];
      const outcomes = await Promise.all(stores.map((store, index) =>
        store.updateIfProcessingLeaseExpired(runId!, expiredAt, (current) => {
          mutateCalls[index] += 1;
          return {
            ...current,
            status: "cleanup_pending",
            stage: "cleanup_pending",
            progress: 96,
            processingLeaseId: null,
            processingLeaseExpiresAt: null,
            updatedAt: expiredAt.toISOString()
          };
        })
      ));

      expect(mutateCalls).toEqual([1, 1]);
      expect(outcomes.filter((outcome) => outcome.applied)).toHaveLength(1);
      const loser = outcomes.find((outcome) => !outcome.applied);
      expect(loser?.record).toMatchObject({
        id: runId,
        status: "cleanup_pending",
        processingLeaseId: null,
        processingLeaseExpiresAt: null
      });
      expect(loser?.record.version).toBe(outcomes.find((outcome) => outcome.applied)?.record.version);
    } catch (error) {
      throw sanitizedProbeFailure(error, databaseUrl!);
    } finally {
      if (runId) await setupStore.remove(runId);
    }
  }, 30_000);

  it("allows only one durable cleanup-retry claim and recovers an orphaned dispatch", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    expect(databaseUrl, "DATABASE_URL must be set for the explicit Neon live probe").toBeTruthy();

    const store = new NeonRunStore(databaseUrl!);
    const namespace = `probe:${crypto.randomUUID()}`;
    let runId: string | undefined;
    try {
      const claimedAt = new Date("2026-09-03T18:10:00.000Z");
      const created = await store.create(runInput(
        `${namespace}:cleanup-owner`,
        `${namespace}:cleanup-quota`,
        "cleanup-retry-claim"
      ));
      runId = created.record.id;
      await store.update(runId, (record) => ({
        ...transitionRun(record, "cleanup_pending", claimedAt),
        terminalAfterCleanup: "expired"
      }));

      const claims = await Promise.all(Array.from({ length: 16 }, () =>
        store.claimCleanupRetry(runId!, claimedAt)
      ));
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(await store.get(runId)).toMatchObject({
        cleanupRetryClaimedAt: claimedAt.toISOString(),
        cleanupRetryDispatchStatus: "dispatching",
        cleanupRetryWorkflowRunId: null
      });
      expect((await store.listCleanupCandidates(
        new Date(claimedAt.getTime() + CLEANUP_RETRY_DISPATCH_GRACE_MS - 1),
        100
      )).map((record) => record.id)).not.toContain(runId);
      expect((await store.listCleanupCandidates(
        new Date(claimedAt.getTime() + CLEANUP_RETRY_DISPATCH_GRACE_MS),
        100
      )).map((record) => record.id)).toContain(runId);
    } catch (error) {
      throw sanitizedProbeFailure(error, databaseUrl!);
    } finally {
      if (runId) await store.remove(runId);
    }
  }, 30_000);

  it("allows only one durable analysis Workflow dispatch claim", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    expect(databaseUrl, "DATABASE_URL must be set for the explicit Neon live probe").toBeTruthy();

    const store = new NeonRunStore(databaseUrl!);
    const namespace = `probe:${crypto.randomUUID()}`;
    let runId: string | undefined;
    try {
      const claimedAt = new Date("2026-09-03T18:20:00.000Z");
      const created = await store.create(runInput(
        `${namespace}:analysis-owner`,
        `${namespace}:analysis-quota`,
        "analysis-dispatch-claim"
      ));
      runId = created.record.id;
      const admission = await store.claimAdmission(runId, claimedAt);
      expect(admission).not.toBeNull();

      const claims = await Promise.all(Array.from({ length: 16 }, () =>
        store.claimAnalysisDispatch(runId!, admission!.admissionLeaseId, claimedAt)
      ));
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(await store.get(runId)).toMatchObject({
        analysisDispatchClaimedAt: claimedAt.toISOString(),
        analysisDispatchStatus: "dispatching",
        workflowRunId: null
      });
      expect(await store.claimAdmission(
        runId,
        new Date(claimedAt.getTime() + 10 * 60_000)
      )).toBeNull();
    } catch (error) {
      throw sanitizedProbeFailure(error, databaseUrl!);
    } finally {
      if (runId) await store.remove(runId);
    }
  }, 30_000);
});
