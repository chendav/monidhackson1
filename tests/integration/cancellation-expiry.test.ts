import { describe, expect, it } from "vitest";
import type { PresignUploadResponse } from "@/contracts";
import { LocalDeterministicModel } from "@/lib/analysis/local-model";
import { getConfig } from "@/lib/config";
import { sha256Hex } from "@/lib/crypto";
import { infrastructureCostCommitmentMicroUsd } from "@/lib/cost-estimates";
import { processRun } from "@/lib/pipeline";
import type { MonidAdapter } from "@/lib/providers/monid";
import { cleanupRun, expireDueRuns, expireRun } from "@/lib/runs/expiry";
import { transitionRun } from "@/lib/runs/state-machine";
import { InMemoryRunStore } from "@/lib/runs/store";
import { InMemoryBudgetGuard, type BudgetGuard } from "@/lib/security/budget";
import { stagingBlobPath, type UploadStorage } from "@/lib/storage/uploads";
import { makeMinimalPdf } from "../unit/minimal-pdf";

class RevocationStorage implements UploadStorage {
  readonly durableObjects = new Set<string>();
  readonly removals: string[] = [];
  readonly purges: string[] = [];

  constructor(private readonly bytes: Uint8Array) {}

  async presign(): Promise<PresignUploadResponse> {
    throw new Error("not used");
  }

  async claimIncoming(): Promise<void> {}

  async read(): Promise<Uint8Array> {
    return this.bytes.slice();
  }

  async stage(path: string): Promise<void> {
    this.durableObjects.add(path);
  }

  async temporaryReadUrl(): Promise<string> {
    return "https://private-blob.example/staged.pdf";
  }

  async remove(path: string): Promise<void> {
    this.removals.push(path);
    this.durableObjects.delete(path);
  }

  async purgeIncomingToFence(path: string): Promise<void> {
    this.purges.push(path);
    this.durableObjects.delete(path);
  }

  async sweepExpiredIncoming(): Promise<string[]> {
    return [];
  }
}

const config = getConfig({
  NODE_ENV: "test",
  SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough",
  IP_HASH_SECRET: "test-ip-hash-secret",
  MAX_RUN_COST_MICRO_USD: "2000000",
  DAILY_COST_CAP_MICRO_USD: "20000000"
});

const liveConfig = getConfig({
  NODE_ENV: "test",
  SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough",
  IP_HASH_SECRET: "test-ip-hash-secret",
  MONID_API_KEY: "test-monid-key",
  MONID_PARSE_PROVIDER: "context.dev",
  MONID_PARSE_ENDPOINT: "/parse",
  MONID_RUN_ID_PATH: "run.id",
  MONID_RUN_STATUS_PATH: "run.status",
  MONID_PROVIDER_STATUS_PATH: "run.provider_status",
  MONID_RESULT_URL_PATH: "run.result_url",
  MONID_COST_VALUE_PATH: "run.cost.value",
  MONID_COST_CURRENCY_PATH: "run.cost.currency",
  MONID_COST_VALUE_UNIT: "currency_major",
  MONID_INSPECT_SCHEMA_SHA256: "b".repeat(64),
  MONID_ARTIFACT_HOST_ALLOWLIST: "private-blob.example",
  OPENAI_API_KEY: "test-openai-key",
  MAX_RUN_COST_MICRO_USD: "2000000",
  DAILY_COST_CAP_MICRO_USD: "20000000"
});

class RecordingBudgetGuard implements BudgetGuard {
  readonly settlements: Array<{ runId: string; actualMicroUsd: number }> = [];

  async reserve(): Promise<void> {}

  async settle(runId: string, actualMicroUsd: number): Promise<void> {
    this.settlements.push({ runId, actualMicroUsd });
  }
}

async function createUploadRun(
  store: InMemoryRunStore,
  bytes: Uint8Array,
  ownerId: string,
  now: Date
) {
  const sha = sha256Hex(bytes);
  const blobPath = `incoming/test/${ownerId}/${sha}.pdf`;
  const record = (await store.create({
    ownerId,
    quotaKey: `ip:${ownerId}`,
    input: {
      documents: [{
        role: "base",
        source: {
          type: "upload",
          blob_path: blobPath,
          sha256: sha,
          size_bytes: bytes.byteLength,
          filename: "fixture.pdf"
        }
      }]
    },
    idempotencyKey: null,
    reservedMicroUsd: 104_500,
    now
  })).record;
  return { record, blobPath };
}

describe("active-worker cancellation and stale-lease cleanup", () => {
  it("fences a blocked worker immediately and expires only after its lease quiesces", async () => {
    const claimedAt = new Date("2026-09-02T00:00:00.000Z");
    const bytes = makeMinimalPdf(["The bidder must provide a detailed service plan."]);
    const store = new InMemoryRunStore();
    const storage = new RevocationStorage(bytes);
    const { record } = await createUploadRun(store, bytes, "guest:cancel", claimedAt);
    const local = new LocalDeterministicModel();
    let signalStarted!: () => void;
    let releaseModel!: () => void;
    const modelStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
    const modelBlocked = new Promise<void>((resolve) => { releaseModel = resolve; });
    const model = {
      async extract(input: Parameters<typeof local.extract>[0]) {
        signalStarted();
        await modelBlocked;
        return local.extract(input);
      },
      answer: local.answer.bind(local)
    };

    const worker = processRun(record.id, {
      store,
      uploadStorage: storage,
      budget: new InMemoryBudgetGuard(config),
      config,
      model,
      now: () => claimedAt
    });
    await modelStarted;

    const beforeDelete = await store.get(record.id);
    expect(beforeDelete?.status).toBe("extracting");
    expect(beforeDelete?.processingLeaseId).not.toBeNull();
    expect(beforeDelete?.processingLeaseExpiresAt).toBe("2026-09-02T00:00:45.000Z");
    expect(beforeDelete?.cleanupExpectedResourceIds.some((id) => id.startsWith("page-text:"))).toBe(true);
    expect(beforeDelete?.cleanupExpectedResourceIds.some((id) => id.startsWith("parsed:"))).toBe(true);

    const pending = await expireRun(
      beforeDelete!,
      store,
      storage,
      new Date("2026-09-02T00:00:20.000Z")
    );
    expect(pending.status).toBe("cleanup_pending");
    expect(pending.terminalAfterCleanup).toBe("expired");
    expect(pending.cleanupConfirmed).toBe(false);
    expect(pending.result).toBeNull();
    expect(pending.citationReceipts).toEqual([]);
    expect(pending.processingLeaseId).toBeNull();
    expect(pending.processingLeaseExpiresAt).toBe("2026-09-02T00:00:45.000Z");
    expect(pending.processingFence).toBe((beforeDelete?.processingFence ?? 0) + 1);
    expect(pending.expiresAt).toBe("2026-09-02T00:00:45.000Z");
    expect(pending.cleanupReceipts.some((receipt) =>
      receipt.resourceKind === "page_text" && receipt.status === "deleted"
    )).toBe(false);

    const stillPending = await expireRun(
      pending,
      store,
      storage,
      new Date("2026-09-02T00:00:44.999Z")
    );
    expect(stillPending.status).toBe("cleanup_pending");
    expect(stillPending.cleanupConfirmed).toBe(false);

    // Model a revoked worker recreating its deterministic stage after the
    // first cleanup pass. Before quiescence, historical receipts are not
    // treated as proof that this newly-created object is absent.
    const stagePath = stagingBlobPath(record.id, 0);
    const removalsBeforeRecreate = storage.removals.filter((path) => path === stagePath).length;
    storage.durableObjects.add(stagePath);
    expect(storage.durableObjects.has(stagePath)).toBe(true);

    releaseModel();
    const fencedWorkerResult = await worker;
    expect(fencedWorkerResult.status).toBe("cleanup_pending");
    expect(fencedWorkerResult.result).toBeNull();
    expect(fencedWorkerResult.citationReceipts).toEqual([]);

    // An elapsed preserved lease is only a quiescence deadline. It must not
    // make cleanup_pending reclaimable as analysis work.
    expect(await store.claimProcessing(
      record.id,
      new Date("2026-09-02T00:00:45.001Z")
    )).toBeNull();

    const sourcePurgesBeforeQuiescence = storage.purges.length;
    const expired = await expireRun(
      fencedWorkerResult,
      store,
      storage,
      new Date("2026-09-02T00:00:45.001Z")
    );
    expect(expired.status).toBe("expired");
    expect(expired.cleanupConfirmed).toBe(true);
    expect(expired.result).toBeNull();
    expect(expired.citationReceipts).toEqual([]);
    expect(expired.processingLeaseId).toBeNull();
    expect(expired.processingLeaseExpiresAt).toBeNull();
    expect(storage.durableObjects.has(stagePath)).toBe(false);
    expect(storage.removals.filter((path) => path === stagePath)).toHaveLength(
      removalsBeforeRecreate + 1
    );
    expect(storage.purges).toHaveLength(sourcePurgesBeforeQuiescence);
    expect(expired.cleanupReceipts).toContainEqual(expect.objectContaining({
      resourceId: `sha256:${sha256Hex(`staged:${record.id}:0`)}`,
      status: "deleted",
      attemptedAt: "2026-09-02T00:00:45.001Z"
    }));
    expect(expired.cleanupReceipts.some((receipt) =>
      receipt.resourceKind === "page_text" && receipt.status === "deleted"
    )).toBe(true);
    expect(expired.cleanupReceipts.some((receipt) =>
      receipt.resourceKind === "parsed_markdown" && receipt.status === "deleted"
    )).toBe(true);
  });

  it("the maintenance sweep fences and purges a crashed mid-stage worker at lease expiry", async () => {
    const claimedAt = new Date("2026-09-02T02:00:00.000Z");
    const bytes = makeMinimalPdf(["The bidder shall provide pricing evidence."]);
    const store = new InMemoryRunStore();
    const storage = new RevocationStorage(bytes);
    const { record, blobPath } = await createUploadRun(store, bytes, "guest:crash", claimedAt);
    storage.durableObjects.add(blobPath);

    const claim = await store.claimProcessing(record.id, claimedAt);
    expect(claim).not.toBeNull();
    const stagePath = stagingBlobPath(record.id, 0);
    storage.durableObjects.add(stagePath);
    await store.update(record.id, (current) => transitionRun(current, "staging", claimedAt), {
      leaseId: claim!.leaseId,
      fence: claim!.fence
    });

    const swept = await expireDueRuns(
      store,
      storage,
      new Date("2026-09-02T02:20:00.001Z")
    );
    expect(swept.map((item) => item.id)).toContain(record.id);
    const expired = await store.get(record.id);
    expect(expired?.status).toBe("expired");
    expect(expired?.cleanupConfirmed).toBe(true);
    expect(expired?.result).toBeNull();
    expect(expired?.processingLeaseId).toBeNull();
    expect(expired?.processingFence).toBe(claim!.fence + 1);
    expect(storage.durableObjects.has(blobPath)).toBe(false);
    expect(storage.durableObjects.has(stagePath)).toBe(false);
    expect(storage.purges).toContain(blobPath);
    expect(storage.removals).toContain(stagePath);

    const replacement = await createUploadRun(
      store,
      bytes,
      "guest:crash",
      new Date("2026-09-02T02:20:01.000Z")
    );
    expect(replacement.record.status).toBe("queued");
  });

  it("retains chargeable spend after cancellation and drops copied Markdown before returning", async () => {
    const claimedAt = new Date("2026-09-02T01:00:00.000Z");
    const bytes = makeMinimalPdf([
      "Solicitation TEST-001. The bidder must submit a signed form. " +
      "A bid that fails a mandatory requirement is non-compliant."
    ]);
    const store = new InMemoryRunStore();
    const storage = new RevocationStorage(bytes);
    const budget = new RecordingBudgetGuard();
    const { record } = await createUploadRun(store, bytes, "guest:paid-cancel", claimedAt);
    const failureReservationMicroUsd =
      liveConfig.MONID_PARSE_RESERVE_MICRO_USD + liveConfig.OPENAI_RUN_RESERVE_MICRO_USD +
      infrastructureCostCommitmentMicroUsd({
        documentCount: 1,
        storageProvider: null,
        neonCostCuCeiling: liveConfig.NEON_COST_CU_CEILING,
        runTtlHours: liveConfig.RUN_TTL_HOURS
      });
    await store.update(record.id, (current) => ({
      ...current,
      reservedMicroUsd: failureReservationMicroUsd
    }));
    const local = new LocalDeterministicModel();
    const received = { input: null as Parameters<typeof local.extract>[0] | null };
    let signalStarted!: () => void;
    let releaseModel!: () => void;
    const modelStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
    const modelBlocked = new Promise<void>((resolve) => { releaseModel = resolve; });
    const model = {
      async extract(input: Parameters<typeof local.extract>[0]) {
        received.input = input;
        signalStarted();
        await modelBlocked;
        const extracted = await local.extract(input);
        return { ...extracted, inputTokens: 1_000, outputTokens: 500 };
      },
      answer: local.answer.bind(local)
    };
    const retainedMonidResult = {
      markdown: "The bidder must submit a signed form.",
      runId: "paid-monid-run",
      costAmount: 0.0045,
      costValueUnit: "currency_major" as const,
      costCurrency: "USD",
      costProvenance: {
        kind: "credentialed_inspect" as const,
        inspect_schema_sha256: "b".repeat(64),
        value_path: "run.cost.value",
        currency_path: "run.cost.currency",
        value_unit: "currency_major" as const,
        source_value: 0.0045,
        source_currency: "USD" as const
      },
      providerArtifactUrl: "https://private-blob.example/result.md",
      providerRetention: "unknown" as const,
      terminalPayload: { raw: "provider response" }
    };
    const monid = {
      async parse(input: { beforePaidDispatch?: () => Promise<void> }) {
        await input.beforePaidDispatch?.();
        return retainedMonidResult;
      }
    } as unknown as MonidAdapter;

    const worker = processRun(record.id, {
      store,
      uploadStorage: storage,
      budget,
      config: liveConfig,
      model,
      monid,
      now: () => claimedAt
    });
    await modelStarted;
    expect(received.input?.[0].parsed_markdown).toContain("signed form");

    const active = await store.get(record.id);
    await expireRun(active!, store, storage, new Date("2026-09-02T01:00:20.000Z"));
    releaseModel();
    const cancelled = await worker;

    expect(cancelled.status).toBe("cleanup_pending");
    expect(cancelled.result).toBeNull();
    expect(received.input?.[0].parsed_markdown).toBe("");
    expect(retainedMonidResult).toMatchObject({
      markdown: "", providerArtifactUrl: "", terminalPayload: null
    });
    expect(budget.settlements).toEqual([{
      runId: record.id,
      // Terminal failures retain the full safety reservation so repeated
      // failures cannot reopen the daily budget after chargeable work began.
      actualMicroUsd: failureReservationMicroUsd
    }]);
  });

  it("selects a bounded set of due or stale records without returning future audit rows", async () => {
    const createdAt = new Date("2026-09-02T03:00:00.000Z");
    const dueAt = new Date("2026-09-03T04:00:00.000Z");
    const bytes = makeMinimalPdf(["bounded cleanup candidates"]);
    const store = new InMemoryRunStore();

    for (const owner of ["one", "two", "three"]) {
      await createUploadRun(store, bytes, `guest:${owner}`, createdAt);
    }
    const stale = await createUploadRun(store, bytes, "guest:stale", dueAt);
    await store.claimProcessing(
      stale.record.id,
      new Date("2026-09-03T03:00:00.000Z"),
      30 * 60_000
    );
    const futureAudit = await createUploadRun(store, bytes, "guest:audit", createdAt);
    const expired = await expireRun(futureAudit.record, store, new RevocationStorage(bytes), dueAt);
    expect(expired.status).toBe("expired");
    expect(expired.auditExpiresAt).not.toBeNull();

    const candidates = await store.listCleanupCandidates(dueAt, 2);
    expect(candidates).toHaveLength(2);
    expect(candidates.some((record) => record.id === expired.id)).toBe(false);
    expect((await store.listCleanupCandidates(dueAt, 100)).map((record) => record.id))
      .toContain(stale.record.id);
  });

  it("keeps expired as the monotonic winner when failed cleanup races with expiry", async () => {
    const claimedAt = new Date("2026-09-02T05:00:00.000Z");
    const bytes = makeMinimalPdf(["monotonic terminal intent"]);
    const store = new InMemoryRunStore();
    const storage = new RevocationStorage(bytes);
    const { record } = await createUploadRun(store, bytes, "guest:terminal", claimedAt);
    const claim = await store.claimProcessing(record.id, claimedAt);
    expect(claim).not.toBeNull();

    const failedPending = await cleanupRun(
      claim!.record,
      store,
      storage,
      "failed",
      new Date("2026-09-02T05:00:20.000Z")
    );
    expect(failedPending.terminalAfterCleanup).toBe("failed");

    const expiredPending = await expireRun(
      failedPending,
      store,
      storage,
      new Date("2026-09-02T05:00:30.000Z")
    );
    expect(expiredPending.terminalAfterCleanup).toBe("expired");

    const failedAgain = await cleanupRun(
      expiredPending,
      store,
      storage,
      "failed",
      new Date("2026-09-02T05:00:35.000Z")
    );
    expect(failedAgain.terminalAfterCleanup).toBe("expired");

    const completed = await expireRun(
      failedAgain,
      store,
      storage,
      new Date("2026-09-02T05:00:45.001Z")
    );
    expect(completed.status).toBe("expired");
    expect(completed.terminalAfterCleanup).toBeNull();
  });
});
