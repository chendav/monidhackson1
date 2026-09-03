import { describe, expect, it, vi } from "vitest";
import type { PresignUploadResponse } from "@/contracts";
import { NeonRunStore } from "@/db/neon-store";
import { sha256Hex } from "@/lib/crypto";
import { cleanupRun, expireDueRuns } from "@/lib/runs/expiry";
import {
  PROCESSING_LEASE_MS,
  InMemoryRunStore
} from "@/lib/runs/store";
import { toRunStatusResponse } from "@/lib/runs/types";
import {
  SOURCE_CLEANUP_CAPTURE_SLA_MS,
  armSourceCleanupWatchdog,
  markSourceProviderCallStarted,
  markSourceProviderResultCaptured,
  recordSourceCleanupWatchdogScheduled,
  runSourceCleanupWatchdog
} from "@/lib/runs/source-cleanup-watchdog";
import { transitionRun } from "@/lib/runs/state-machine";
import type { RunRecord } from "@/lib/runs/types";
import { stagingBlobPath, type UploadStorage } from "@/lib/storage/uploads";

class WatchdogStorage implements UploadStorage {
  readonly objects = new Set<string>();
  readonly removals: Array<{ path: string; at: string }> = [];
  readonly purges: Array<{ path: string; at: string }> = [];

  constructor(private readonly clock: () => Date) {}

  async presign(): Promise<PresignUploadResponse> { throw new Error("not used"); }
  async claimIncoming(): Promise<void> {}
  async read(): Promise<Uint8Array> { throw new Error("not used"); }
  async stage(): Promise<void> {}
  async temporaryReadUrl(): Promise<string> { throw new Error("not used"); }
  async sweepExpiredIncoming(): Promise<string[]> { return []; }

  async purgeIncomingToFence(path: string): Promise<void> {
    this.purges.push({ path, at: this.clock().toISOString() });
    this.objects.delete(path);
  }

  async remove(path: string): Promise<void> {
    this.removals.push({ path, at: this.clock().toISOString() });
    this.objects.delete(path);
  }
}

class RenewingRaceStore extends InMemoryRunStore {
  renewBeforeConditionalCleanup: {
    claim: { leaseId: string; fence: number };
    at: Date;
  } | null = null;

  override async updateIfProcessingLeaseExpired(
    id: string,
    expiredAt: Date,
    mutate: (record: RunRecord) => RunRecord
  ) {
    if (this.renewBeforeConditionalCleanup) {
      const renewal = this.renewBeforeConditionalCleanup;
      this.renewBeforeConditionalCleanup = null;
      await this.heartbeatProcessing(id, renewal.claim, renewal.at, PROCESSING_LEASE_MS);
    }
    return super.updateIfProcessingLeaseExpired(id, expiredAt, mutate);
  }
}

async function enterParsing(store: InMemoryRunStore, runId: string, at: Date) {
  const claim = await store.claimProcessing(runId, at);
  expect(claim).not.toBeNull();
  for (const status of ["staging", "page_indexing", "parsing"] as const) {
    await store.update(runId, (record) => transitionRun(record, status, at), {
      leaseId: claim!.leaseId,
      fence: claim!.fence
    });
  }
  return { leaseId: claim!.leaseId, fence: claim!.fence };
}

describe("durable per-document source cleanup watchdog", () => {
  it("leaves an expired worker with an armed watchdog to maintenance before any paid call", async () => {
    const startedAt = new Date("2026-09-03T11:00:00.000Z");
    let clock = startedAt;
    const store = new InMemoryRunStore();
    const blobPath = `incoming/watchdog/pre-dispatch/${"0".repeat(64)}.pdf`;
    const created = (await store.create({
      ownerId: "guest:watchdog-pre-dispatch-kill",
      quotaKey: "ip:watchdog-pre-dispatch-kill",
      input: {
        documents: [{
          role: "base",
          source: {
            type: "upload",
            blob_path: blobPath,
            sha256: "0".repeat(64),
            size_bytes: 123,
            filename: "source.pdf"
          }
        }]
      },
      idempotencyKey: null,
      reservedMicroUsd: 104_500,
      now: startedAt
    })).record;
    const claim = await enterParsing(store, created.id, startedAt);
    const stagePath = stagingBlobPath(created.id, 0);
    const storage = new WatchdogStorage(() => clock);
    storage.objects.add(blobPath);
    storage.objects.add(stagePath);

    const armed = await armSourceCleanupWatchdog({
      store,
      runId: created.id,
      documentIndex: 0,
      documentId: "pre-dispatch-document-id",
      resourceIds: [`blob:${blobPath}`, `staged:${created.id}:0`],
      claim,
      now: new Date(startedAt.getTime() + 1_000)
    });
    await recordSourceCleanupWatchdogScheduled({
      store,
      runId: created.id,
      registrationId: armed.registrationId,
      workflowRunId: "possibly-ack-lost-package-watchdog",
      claim,
      now: new Date(startedAt.getTime() + 2_000)
    });
    expect(await store.get(created.id)).toMatchObject({
      status: "parsing",
      paidProviderAttemptStartedAt: null,
      sourceCleanupWatchdogs: [{
        registrationId: armed.registrationId,
        watchdogScheduledAt: new Date(startedAt.getTime() + 2_000).toISOString(),
        providerCallStartedAt: null
      }]
    });

    // Simulate a hard kill after package-watchdog dispatch but before the
    // paid-call marker. Reclaiming would execute pipeline scheduling again.
    clock = new Date(startedAt.getTime() + PROCESSING_LEASE_MS + 1);
    expect(await store.claimProcessing(created.id, clock)).toBeNull();

    const maintained = await expireDueRuns(store, storage, clock);
    expect(maintained.map((record) => record.id)).toContain(created.id);
    expect(await store.get(created.id)).toMatchObject({
      status: "expired",
      cleanupConfirmed: true,
      paidProviderAttemptStartedAt: null,
      processingLeaseId: null,
      processingLeaseExpiresAt: null
    });
    expect(storage.objects.has(blobPath)).toBe(false);
    expect(storage.objects.has(stagePath)).toBe(false);
  });

  it("still permits expired-lease reclaim before any cleanup watchdog is armed", async () => {
    const startedAt = new Date("2026-09-03T11:30:00.000Z");
    const store = new InMemoryRunStore();
    const created = (await store.create({
      ownerId: "guest:pre-watchdog-reclaim",
      quotaKey: "ip:pre-watchdog-reclaim",
      input: {
        documents: [{
          role: "base",
          source: {
            type: "url",
            url: "https://canadabuys.canada.ca/pre-watchdog-reclaim.pdf"
          }
        }]
      },
      idempotencyKey: null,
      reservedMicroUsd: 104_500,
      now: startedAt
    })).record;
    const first = await enterParsing(store, created.id, startedAt);
    const reclaimed = await store.claimProcessing(
      created.id,
      new Date(startedAt.getTime() + PROCESSING_LEASE_MS + 1)
    );

    expect(reclaimed).not.toBeNull();
    expect(reclaimed).toMatchObject({
      fence: first.fence + 1,
      record: {
        status: "validating",
        sourceCleanupWatchdogs: [],
        paidProviderAttemptStartedAt: null
      }
    });
    expect(reclaimed!.leaseId).not.toBe(first.leaseId);
  });

  it("does not delete before capture and recovers a hard-killed paid worker within 60 seconds", async () => {
    const startedAt = new Date("2026-09-03T12:00:00.000Z");
    let clock = startedAt;
    const store = new InMemoryRunStore();
    const blobPath = `incoming/watchdog/opaque/${"a".repeat(64)}.pdf`;
    const created = (await store.create({
      ownerId: "guest:watchdog-hard-kill",
      quotaKey: "ip:watchdog-hard-kill",
      input: {
        documents: [{
          role: "base",
          source: {
            type: "upload",
            blob_path: blobPath,
            sha256: "a".repeat(64),
            size_bytes: 123,
            filename: "source.pdf"
          }
        }]
      },
      idempotencyKey: null,
      reservedMicroUsd: 104_500,
      now: startedAt
    })).record;
    const claim = await enterParsing(store, created.id, startedAt);
    const stagePath = stagingBlobPath(created.id, 0);
    const storage = new WatchdogStorage(() => clock);
    storage.objects.add(blobPath);
    storage.objects.add(stagePath);

    const registeredAt = new Date(startedAt.getTime() + 1_000);
    const armed = await armSourceCleanupWatchdog({
      store,
      runId: created.id,
      documentIndex: 0,
      documentId: "opaque-document-id",
      resourceIds: [`blob:${blobPath}`, `staged:${created.id}:0`],
      claim,
      now: registeredAt
    });
    await recordSourceCleanupWatchdogScheduled({
      store,
      runId: created.id,
      registrationId: armed.registrationId,
      workflowRunId: "cleanup-watchdog-workflow",
      claim,
      now: registeredAt
    });
    await markSourceProviderCallStarted({
      store,
      runId: created.id,
      registrationId: armed.registrationId,
      claim,
      sourceAccessExpiresAt: new Date(startedAt.getTime() + 5 * 60_000),
      reservedMicroUsd: 4_500,
      totalPlannedMonidAttempts: 1,
      remainingOpenAiCommitmentMicroUsd: 100_000,
      maximumRunCostMicroUsd: 2_000_000,
      now: new Date(startedAt.getTime() + 2_000)
    });
    const paidAttempt = await store.get(created.id);
    expect(paidAttempt).toMatchObject({
      costMicroUsd: 4_500,
      costs: [{
        attempt_id: armed.registrationId,
        status: "pending",
        actual_micro_usd: null,
        estimated_micro_usd: 4_500
      }]
    });
    expect(toRunStatusResponse(paidAttempt!).cost_accounting_status)
      .toBe("estimated_pending");

    // The independently scheduled watchdog may poll while Monid is still
    // fetching. It must be read-only until the result capture is durable.
    clock = new Date(startedAt.getTime() + 4_000);
    const beforeCapture = await runSourceCleanupWatchdog({
      store,
      storage,
      runId: created.id,
      registrationId: armed.registrationId,
      now: clock
    });
    expect(beforeCapture.outcome).toBe("waiting_for_capture");
    expect(storage.removals).toEqual([]);
    expect(storage.purges).toEqual([]);
    expect(storage.objects.has(stagePath)).toBe(true);

    const capturedAt = new Date(startedAt.getTime() + 5_000);
    await markSourceProviderResultCaptured({
      store,
      runId: created.id,
      registrationId: armed.registrationId,
      providerResultIdSha256: sha256Hex("opaque-provider-result-id"),
      parsedResourceId: "parsed:opaque-document-id",
      claim,
      now: capturedAt
    });

    // Simulate a hard kill here: the main worker performs no deletion and no
    // further heartbeat. A restarted independent watchdog observes only the
    // persisted capture marker and opaque resource identifiers.
    clock = new Date(capturedAt.getTime() + 10_000);
    const recovered = await runSourceCleanupWatchdog({
      store,
      storage,
      runId: created.id,
      registrationId: armed.registrationId,
      now: clock
    });
    expect(recovered.outcome).toBe("waiting_for_worker");
    expect(storage.objects.has(stagePath)).toBe(false);
    expect(storage.objects.has(blobPath)).toBe(false);
    const afterDelete = await store.get(created.id);
    const watchdog = afterDelete!.sourceCleanupWatchdogs[0];
    expect(watchdog.providerResultCapturedAt).toBe(capturedAt.toISOString());
    expect(watchdog.cleanupConfirmedAt).toBe(clock.toISOString());
    expect(watchdog.providerResultIdSha256).toBe(sha256Hex("opaque-provider-result-id"));
    expect(JSON.stringify(watchdog)).not.toContain("opaque-provider-result-id");
    expect(clock.getTime() - capturedAt.getTime()).toBeLessThanOrEqual(
      SOURCE_CLEANUP_CAPTURE_SLA_MS
    );

    // Even after the short lease elapses, a second workflow cannot replay the
    // ambiguous paid operation. The watchdog, not processRun, finalizes the
    // failed run after worker quiescence.
    clock = new Date(startedAt.getTime() + PROCESSING_LEASE_MS + 1);
    expect(await store.claimProcessing(created.id, clock)).toBeNull();
    const finalized = await runSourceCleanupWatchdog({
      store,
      storage,
      runId: created.id,
      registrationId: armed.registrationId,
      now: clock
    });
    expect(finalized.outcome).toBe("complete");
    expect(clock.getTime() - capturedAt.getTime()).toBeLessThanOrEqual(
      SOURCE_CLEANUP_CAPTURE_SLA_MS
    );
    const failed = await store.get(created.id);
    expect(failed).toMatchObject({
      status: "failed",
      cleanupConfirmed: true,
      result: null,
      processingLeaseId: null,
      processingLeaseExpiresAt: null
    });
    expect(failed!.cleanupReceipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: `staged:${created.id}:0`, status: "deleted" }),
      expect.objectContaining({ resourceId: "parsed:opaque-document-id", status: "deleted" })
    ]));
  });

  it("retains staging after a hard kill during an unobserved provider call, then cleans at URL expiry", async () => {
    const startedAt = new Date("2026-09-03T13:00:00.000Z");
    let clock = startedAt;
    const store = new InMemoryRunStore();
    const blobPath = `incoming/watchdog/unknown/${"b".repeat(64)}.pdf`;
    const created = (await store.create({
      ownerId: "guest:watchdog-unknown",
      quotaKey: "ip:watchdog-unknown",
      input: {
        documents: [{
          role: "base",
          source: {
            type: "upload",
            blob_path: blobPath,
            sha256: "b".repeat(64),
            size_bytes: 456,
            filename: "source.pdf"
          }
        }]
      },
      idempotencyKey: null,
      reservedMicroUsd: 104_500,
      now: startedAt
    })).record;
    const claim = await enterParsing(store, created.id, startedAt);
    const stagePath = stagingBlobPath(created.id, 0);
    const storage = new WatchdogStorage(() => clock);
    storage.objects.add(blobPath);
    storage.objects.add(stagePath);

    const armed = await armSourceCleanupWatchdog({
      store,
      runId: created.id,
      documentIndex: 0,
      documentId: "unknown-outcome-document",
      resourceIds: [`blob:${blobPath}`, `staged:${created.id}:0`],
      claim,
      now: new Date(startedAt.getTime() + 1_000)
    });
    await recordSourceCleanupWatchdogScheduled({
      store,
      runId: created.id,
      registrationId: armed.registrationId,
      workflowRunId: "unknown-outcome-watchdog",
      claim,
      now: new Date(startedAt.getTime() + 1_000)
    });
    const accessExpiresAt = new Date(startedAt.getTime() + 5 * 60_000);
    await markSourceProviderCallStarted({
      store,
      runId: created.id,
      registrationId: armed.registrationId,
      claim,
      sourceAccessExpiresAt: accessExpiresAt,
      reservedMicroUsd: 4_500,
      totalPlannedMonidAttempts: 1,
      remainingOpenAiCommitmentMicroUsd: 100_000,
      maximumRunCostMicroUsd: 2_000_000,
      now: new Date(startedAt.getTime() + 2_000)
    });

    // Simulate a process death while the remote call is unresolved. Neither a
    // network timeout nor the local lease expiry proves the provider stopped
    // reading the still-valid signed URL.
    clock = new Date(startedAt.getTime() + PROCESSING_LEASE_MS + 1);
    const unresolved = await runSourceCleanupWatchdog({
      store,
      storage,
      runId: created.id,
      registrationId: armed.registrationId,
      now: clock
    });
    expect(unresolved.outcome).toBe("waiting_for_capture");
    expect(storage.removals).toEqual([]);
    expect(storage.purges).toEqual([]);
    expect(storage.objects.has(stagePath)).toBe(true);

    clock = new Date(accessExpiresAt.getTime() + 1);
    const expiredAccess = await runSourceCleanupWatchdog({
      store,
      storage,
      runId: created.id,
      registrationId: armed.registrationId,
      now: clock
    });
    expect(expiredAccess.outcome).toBe("complete");
    expect(storage.objects.has(stagePath)).toBe(false);
    const failed = await store.get(created.id);
    expect(failed).toMatchObject({ status: "failed", result: null, cleanupConfirmed: true });
    expect(failed!.sourceCleanupWatchdogs[0]).toMatchObject({
      status: "cancelled",
      providerResultCapturedAt: null,
      sourceAccessExpiresAt: accessExpiresAt.toISOString(),
      cleanupConfirmedAt: clock.toISOString()
    });
    expect(clock.getTime() - startedAt.getTime()).toBeGreaterThan(
      SOURCE_CLEANUP_CAPTURE_SLA_MS
    );
  });

  it("blocks the next Monid dispatch when an earlier settlement consumed its remaining commitment", async () => {
    const startedAt = new Date("2026-09-03T13:30:00.000Z");
    const store = new InMemoryRunStore();
    const created = (await store.create({
      ownerId: "guest:watchdog-remaining-budget",
      quotaKey: "ip:watchdog-remaining-budget",
      input: { documents: [0, 1].map((index) => ({
        role: index === 0 ? "base" as const : "amendment" as const,
        source: { type: "url" as const, url: `https://canadabuys.canada.ca/source-${index}.pdf` }
      })) },
      idempotencyKey: null,
      reservedMicroUsd: 109_000,
      now: startedAt
    })).record;
    const claim = await enterParsing(store, created.id, startedAt);
    const first = await armSourceCleanupWatchdog({
      store,
      runId: created.id,
      documentIndex: 0,
      documentId: "first-budget-document",
      resourceIds: [`staged:${created.id}:0`],
      claim,
      now: startedAt
    });
    await recordSourceCleanupWatchdogScheduled({
      store,
      runId: created.id,
      registrationId: first.registrationId,
      workflowRunId: "first-budget-watchdog",
      claim,
      now: startedAt
    });
    await markSourceProviderCallStarted({
      store,
      runId: created.id,
      registrationId: first.registrationId,
      claim,
      sourceAccessExpiresAt: new Date(startedAt.getTime() + 5 * 60_000),
      reservedMicroUsd: 4_500,
      totalPlannedMonidAttempts: 2,
      remainingOpenAiCommitmentMicroUsd: 100_000,
      maximumRunCostMicroUsd: 2_000_000,
      now: startedAt
    });
    await markSourceProviderResultCaptured({
      store,
      runId: created.id,
      registrationId: first.registrationId,
      providerResultIdSha256: sha256Hex("first-budget-result"),
      costEvent: {
        attempt_id: first.registrationId,
        provider: "monid",
        operation: "context_dev_parse",
        status: "succeeded",
        actual_micro_usd: 10_000,
        estimated_micro_usd: null,
        latency_ms: 25,
        retry_of: null,
        cost_provenance: null
      },
      claim,
      now: startedAt
    });
    const second = await armSourceCleanupWatchdog({
      store,
      runId: created.id,
      documentIndex: 1,
      documentId: "second-budget-document",
      resourceIds: [`staged:${created.id}:1`],
      claim,
      now: startedAt
    });
    await recordSourceCleanupWatchdogScheduled({
      store,
      runId: created.id,
      registrationId: second.registrationId,
      workflowRunId: "second-budget-watchdog",
      claim,
      now: startedAt
    });

    await expect(markSourceProviderCallStarted({
      store,
      runId: created.id,
      registrationId: second.registrationId,
      claim,
      sourceAccessExpiresAt: new Date(startedAt.getTime() + 5 * 60_000),
      reservedMicroUsd: 4_500,
      totalPlannedMonidAttempts: 2,
      remainingOpenAiCommitmentMicroUsd: 100_000,
      maximumRunCostMicroUsd: 2_000_000,
      now: startedAt
    })).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    const blocked = (await store.get(created.id))!;
    expect(blocked.costs).toHaveLength(1);
    expect(blocked.sourceCleanupWatchdogs[1]).toMatchObject({
      registrationId: second.registrationId,
      status: "armed",
      providerCallStartedAt: null
    });
  });

  it("does not revoke a lease renewed after the watchdog's stale read", async () => {
    const startedAt = new Date("2026-09-03T14:00:00.000Z");
    let clock = startedAt;
    const store = new RenewingRaceStore();
    const created = (await store.create({
      ownerId: "guest:watchdog-race",
      quotaKey: "ip:watchdog-race",
      input: {
        documents: [{
          role: "base",
          source: { type: "url", url: "https://canadabuys.canada.ca/source.pdf" }
        }]
      },
      idempotencyKey: null,
      reservedMicroUsd: 2_000_000,
      now: startedAt
    })).record;
    const claim = await enterParsing(store, created.id, startedAt);
    const stagePath = stagingBlobPath(created.id, 0);
    const storage = new WatchdogStorage(() => clock);
    storage.objects.add(stagePath);
    const armed = await armSourceCleanupWatchdog({
      store,
      runId: created.id,
      documentIndex: 0,
      documentId: "lease-race-document",
      resourceIds: [`staged:${created.id}:0`],
      claim,
      now: startedAt
    });
    await recordSourceCleanupWatchdogScheduled({
      store,
      runId: created.id,
      registrationId: armed.registrationId,
      workflowRunId: "lease-race-watchdog",
      claim,
      now: startedAt
    });
    await markSourceProviderCallStarted({
      store,
      runId: created.id,
      registrationId: armed.registrationId,
      claim,
      sourceAccessExpiresAt: new Date(startedAt.getTime() + 5 * 60_000),
      reservedMicroUsd: 4_500,
      totalPlannedMonidAttempts: 1,
      remainingOpenAiCommitmentMicroUsd: 495_000,
      maximumRunCostMicroUsd: 2_000_000,
      now: startedAt
    });
    await markSourceProviderResultCaptured({
      store,
      runId: created.id,
      registrationId: armed.registrationId,
      providerResultIdSha256: sha256Hex("lease-race-result"),
      claim,
      now: startedAt
    });
    clock = new Date(startedAt.getTime() + 1_000);
    await runSourceCleanupWatchdog({
      store,
      storage,
      runId: created.id,
      registrationId: armed.registrationId,
      now: clock
    });

    // The watchdog reads an expired lease, then the healthy worker renews it
    // before the conditional revocation update reaches the store.
    clock = new Date(startedAt.getTime() + PROCESSING_LEASE_MS + 1);
    store.renewBeforeConditionalCleanup = { claim, at: clock };
    const removalCount = storage.removals.length;
    const purgeCount = storage.purges.length;
    const raced = await runSourceCleanupWatchdog({
      store,
      storage,
      runId: created.id,
      registrationId: armed.registrationId,
      now: clock
    });
    expect(raced.outcome).toBe("waiting_for_worker");
    const current = await store.get(created.id);
    expect(current).toMatchObject({
      status: "parsing",
      processingLeaseId: claim.leaseId,
      processingFence: claim.fence
    });
    expect(new Date(current!.processingLeaseExpiresAt!)).toEqual(
      new Date(clock.getTime() + PROCESSING_LEASE_MS)
    );
    expect(storage.removals).toHaveLength(removalCount);
    expect(storage.purges).toHaveLength(purgeCount);
  });

  it("reports a conditional no-op when an in-memory run reached READY after the stale read", async () => {
    const startedAt = new Date("2026-09-03T15:00:00.000Z");
    const cleanupAt = new Date(startedAt.getTime() + PROCESSING_LEASE_MS + 1);
    const store = new InMemoryRunStore();
    const created = (await store.create({
      ownerId: "guest:ready-race-memory",
      quotaKey: "ip:ready-race-memory",
      input: { documents: [{
        role: "base",
        source: { type: "url", url: "https://canadabuys.canada.ca/source.pdf" }
      }] },
      idempotencyKey: null,
      reservedMicroUsd: 2_000_000,
      now: startedAt
    })).record;
    const claim = await enterParsing(store, created.id, startedAt);
    const stale = (await store.get(created.id))!;
    await store.update(created.id, (record) => ({
      ...record,
      status: "ready",
      stage: "ready",
      progress: 100,
      cleanupConfirmed: true,
      processingLeaseId: null,
      processingLeaseExpiresAt: null
    }), claim);
    const storage = new WatchdogStorage(() => cleanupAt);

    const result = await cleanupRun(stale, store, storage, "failed", cleanupAt, {
      onlyIfProcessingLeaseExpired: true
    });

    expect(result.status).toBe("ready");
    expect(result.processingLeaseExpiresAt).toBeNull();
    expect(storage.removals).toEqual([]);
    expect(storage.purges).toEqual([]);
    expect((await store.get(created.id))?.status).toBe("ready");
  });

  it("reports a Neon conditional no-op for a READY/null-lease winner without issuing storage calls", async () => {
    const startedAt = new Date("2026-09-03T16:00:00.000Z");
    const cleanupAt = new Date(startedAt.getTime() + PROCESSING_LEASE_MS + 1);
    const memory = new InMemoryRunStore();
    const created = (await memory.create({
      ownerId: "guest:ready-race-neon",
      quotaKey: "ip:ready-race-neon",
      input: { documents: [{
        role: "base",
        source: { type: "url", url: "https://canadabuys.canada.ca/source.pdf" }
      }] },
      idempotencyKey: null,
      reservedMicroUsd: 2_000_000,
      now: startedAt
    })).record;
    await enterParsing(memory, created.id, startedAt);
    const stale = (await memory.get(created.id))!;
    const ready: RunRecord = {
      ...stale,
      status: "ready",
      stage: "ready",
      progress: 100,
      cleanupConfirmed: true,
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
      version: stale.version + 1
    };
    const neon = Object.create(NeonRunStore.prototype) as NeonRunStore;
    vi.spyOn(neon, "get").mockResolvedValue(ready);
    const storage = new WatchdogStorage(() => cleanupAt);

    const result = await cleanupRun(stale, neon, storage, "failed", cleanupAt, {
      onlyIfProcessingLeaseExpired: true
    });

    expect(result).toEqual(ready);
    expect(storage.removals).toEqual([]);
    expect(storage.purges).toEqual([]);
    expect(neon.get).toHaveBeenCalledOnce();
  });
});
