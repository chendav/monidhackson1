import { describe, expect, it } from "vitest";
import type { PresignUploadResponse } from "@/contracts";
import { LocalDeterministicModel } from "@/lib/analysis/local-model";
import { getConfig } from "@/lib/config";
import { sha256Hex } from "@/lib/crypto";
import { processRun } from "@/lib/pipeline";
import { InMemoryRunStore } from "@/lib/runs/store";
import { InMemoryBudgetGuard } from "@/lib/security/budget";
import type { UploadStorage } from "@/lib/storage/uploads";
import { makeMinimalPdf } from "../unit/minimal-pdf";

class ClaimStorage implements UploadStorage {
  constructor(private readonly bytes: Uint8Array) {}
  async presign(): Promise<PresignUploadResponse> { throw new Error("not used"); }
  async claimIncoming(): Promise<void> {}
  async read(): Promise<Uint8Array> { return this.bytes.slice(); }
  async stage(): Promise<void> {}
  async temporaryReadUrl(): Promise<string> { throw new Error("not used"); }
  async purgeIncomingToFence(): Promise<void> {}
  async remove(): Promise<void> {}
  async sweepExpiredIncoming(): Promise<string[]> { return []; }
}

describe("atomic processing claim", () => {
  it("lets only one concurrent processRun invocation reach the model", async () => {
    const bytes = makeMinimalPdf(["The bidder must submit a service plan."]);
    const sha = sha256Hex(bytes);
    const store = new InMemoryRunStore();
    const record = (await store.create({
      ownerId: "guest:claim", quotaKey: "ip:claim",
      input: { documents: [{ role: "base", source: {
        type: "upload", blob_path: `incoming/test/${sha}.pdf`, sha256: sha,
        size_bytes: bytes.byteLength, filename: "claim.pdf"
      } }] },
      idempotencyKey: null, reservedMicroUsd: 499_500
    })).record;
    const config = getConfig({
      NODE_ENV: "test",
      SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough"
    });
    let extractionCalls = 0;
    let signalStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const local = new LocalDeterministicModel();
    const model = {
      async extract(input: Parameters<typeof local.extract>[0]) {
        extractionCalls += 1;
        signalStarted();
        await blocked;
        return local.extract(input);
      },
      answer: local.answer.bind(local)
    };
    const dependencies = {
      store,
      uploadStorage: new ClaimStorage(bytes),
      budget: new InMemoryBudgetGuard(config),
      config,
      model
    };
    const first = processRun(record.id, dependencies);
    await started;
    const concurrent = await processRun(record.id, dependencies);
    expect(concurrent.status).not.toBe("queued");
    release();
    const completed = await first;
    expect(["ready", "partial"]).toContain(completed.status);
    expect(completed.cleanupConfirmed).toBe(true);
    expect(extractionCalls).toBe(1);
  });
});
