import { afterEach, describe, expect, it, vi } from "vitest";
import { startProcessingHeartbeat } from "@/lib/runs/processing-heartbeat";
import { InMemoryRunStore } from "@/lib/runs/store";

afterEach(() => {
  vi.useRealTimers();
});

describe("processing lease heartbeat", () => {
  it("extends a healthy worker lease and stops extending after shutdown", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-09-03T14:00:00.000Z");
    let clock = startedAt;
    const store = new InMemoryRunStore();
    const run = (await store.create({
      ownerId: "guest:heartbeat",
      quotaKey: "ip:heartbeat",
      input: {
        documents: [{
          role: "base",
          source: { type: "url", url: "https://canadabuys.canada.ca/heartbeat.pdf" }
        }]
      },
      idempotencyKey: null,
      reservedMicroUsd: 104_500,
      now: startedAt
    })).record;
    const claimed = await store.claimProcessing(run.id, startedAt, 450);
    expect(claimed).not.toBeNull();

    const heartbeat = startProcessingHeartbeat({
      store,
      runId: run.id,
      claim: { leaseId: claimed!.leaseId, fence: claimed!.fence },
      now: () => clock,
      intervalMs: 100,
      leaseMs: 450
    });
    clock = new Date(startedAt.getTime() + 300);
    await vi.advanceTimersByTimeAsync(100);
    expect((await store.get(run.id))?.processingLeaseExpiresAt)
      .toBe(new Date(startedAt.getTime() + 750).toISOString());

    await heartbeat.stop();
    const stoppedExpiry = (await store.get(run.id))?.processingLeaseExpiresAt;
    clock = new Date(startedAt.getTime() + 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await store.get(run.id))?.processingLeaseExpiresAt).toBe(stoppedExpiry);
  });
});
