import { describe, expect, it } from "vitest";
import type { PresignUploadResponse } from "@/contracts";
import { getConfig } from "@/lib/config";
import { sha256Hex } from "@/lib/crypto";
import { processRun } from "@/lib/pipeline";
import { InMemoryRunStore } from "@/lib/runs/store";
import { InMemoryBudgetGuard } from "@/lib/security/budget";
import type { UploadStorage } from "@/lib/storage/uploads";
import { LocalDeterministicModel } from "@/lib/analysis/local-model";
import { makeMinimalPdf } from "../unit/minimal-pdf";

class FakeUploadStorage implements UploadStorage {
  constructor(
    private readonly bytes: Uint8Array,
    private readonly failDeletion: boolean
  ) {}
  async presign(): Promise<PresignUploadResponse> {
    throw new Error("not used");
  }
  async claimIncoming(): Promise<void> {}
  async read(): Promise<Uint8Array> {
    return this.bytes.slice();
  }
  async stage(): Promise<void> {}
  async temporaryReadUrl(): Promise<string> {
    throw new Error("not used by local fallback");
  }
  async remove(): Promise<void> {
    // Staging deletion succeeds independently from incoming content purge.
  }
  async purgeIncomingToFence(): Promise<void> {
    if (this.failDeletion) throw new Error("simulated delete failure");
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

async function seededRun(store: InMemoryRunStore, bytes: Uint8Array) {
  const sha = sha256Hex(bytes);
  return (await store.create({
    ownerId: "guest:test",
    quotaKey: "ip:test",
    input: {
      documents: [{
        role: "base",
        source: {
          type: "upload",
          blob_path: `incoming/test/run/${sha}.pdf`,
          sha256: sha,
          size_bytes: bytes.byteLength,
          filename: "fixture.pdf"
        }
      }]
    },
    idempotencyKey: null,
    reservedMicroUsd: 104_500
  })).record;
}

describe("cleanup readiness gate", () => {
  it("never transitions a run to READY/PARTIAL when source deletion fails", async () => {
    const bytes = makeMinimalPdf(["The bidder must provide a detailed service plan."]);
    const store = new InMemoryRunStore();
    const record = await seededRun(store, bytes);
    const result = await processRun(record.id, {
      store,
      uploadStorage: new FakeUploadStorage(bytes, true),
      budget: new InMemoryBudgetGuard(config),
      config,
      model: new LocalDeterministicModel()
    });
    expect(result.status).toBe("cleanup_pending");
    expect(result.cleanupConfirmed).toBe(false);
    expect(result.result).toBeNull();
    expect(result.error?.code).toBe("SOURCE_CLEANUP_PENDING");
    expect(result.cleanupReceipts.some((receipt) => receipt.resourceKind === "source_blob" && receipt.status === "failed")).toBe(true);
  });

  it("completes only after every application-controlled raw target has a deletion receipt", async () => {
    const bytes = makeMinimalPdf([
      "The bidder must provide a detailed service plan.",
      "The response shall include pricing evidence."
    ]);
    const store = new InMemoryRunStore();
    const record = await seededRun(store, bytes);
    const result = await processRun(record.id, {
      store,
      uploadStorage: new FakeUploadStorage(bytes, false),
      budget: new InMemoryBudgetGuard(config),
      config,
      model: new LocalDeterministicModel()
    });
    expect(result.status).toBe("partial");
    expect(result.cleanupConfirmed).toBe(true);
    expect(result.result?.package_completeness).toBe("incomplete");
    const deleted = new Set(result.cleanupReceipts.filter((receipt) => receipt.status === "deleted").map((receipt) => receipt.resourceId));
    expect(result.cleanupExpectedResourceIds.every((id) => deleted.has(id))).toBe(true);
  });
});
