import { describe, expect, it } from "vitest";
import type { PresignUploadResponse } from "@/contracts";
import { expireDueRuns, expireRun } from "@/lib/runs/expiry";
import { transitionRun } from "@/lib/runs/state-machine";
import { InMemoryRunStore } from "@/lib/runs/store";
import type { UploadStorage } from "@/lib/storage/uploads";

class RetentionStorage implements UploadStorage {
  fail = true;
  async presign(): Promise<PresignUploadResponse> { throw new Error("not used"); }
  async claimIncoming(): Promise<void> {}
  async read(): Promise<Uint8Array> { throw new Error("not used"); }
  async stage(): Promise<void> {}
  async temporaryReadUrl(): Promise<string> { throw new Error("not used"); }
  async purgeIncomingToFence(): Promise<void> { if (this.fail) throw new Error("delete failed"); }
  async remove(): Promise<void> {}
  async sweepExpiredIncoming(): Promise<string[]> { return []; }
}

describe("cleanup retry and retained audit", () => {
  it("stays cleanup_pending on failed delete, then scrubs sensitive metadata after confirmation", async () => {
    const store = new InMemoryRunStore();
    const storage = new RetentionStorage();
    const created = (await store.create({
      ownerId: "guest:retention", quotaKey: "ip:retention",
      input: { documents: [{ role: "base", source: {
        type: "upload", blob_path: "incoming/private/source.pdf", sha256: "a".repeat(64),
        size_bytes: 123, filename: "secret-source.pdf"
      } }] },
      idempotencyKey: "retention-request", reservedMicroUsd: 499_500,
      now: new Date("2026-09-02T00:00:00Z")
    })).record;
    const failed = await store.update(created.id, (record) => transitionRun(record, "failed"));
    const first = await expireRun(failed, store, storage, new Date("2026-09-02T01:00:00Z"));
    expect(first.status).toBe("cleanup_pending");
    expect(first.cleanupConfirmed).toBe(false);
    expect(first.input).not.toBeNull();
    expect(first.result).toBeNull();

    storage.fail = false;
    const scrubbed = await expireRun(first, store, storage, new Date("2026-09-02T01:01:00Z"));
    expect(scrubbed.status).toBe("expired");
    expect(scrubbed.cleanupConfirmed).toBe(true);
    expect(scrubbed.input).toBeNull();
    expect(scrubbed.requestHash).toBeNull();
    expect(scrubbed.idempotencyKey).toBeNull();
    expect(scrubbed.manifests).toEqual([]);
    expect(scrubbed.citationReceipts).toEqual([]);
    expect(scrubbed.cleanupExpectedResourceIds).toEqual([]);
    expect(scrubbed.cleanupReceipts.every((receipt) => receipt.resourceId.startsWith("sha256:"))).toBe(true);
    expect(scrubbed.auditExpiresAt).toBe("2026-10-02T01:01:00.000Z");

    await expireDueRuns(store, storage, new Date("2026-10-02T01:01:00.001Z"));
    expect(await store.get(created.id)).toBeUndefined();
  });
});
