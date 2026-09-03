import { describe, expect, it } from "vitest";
import type { PresignUploadResponse } from "@/contracts";
import { getConfig } from "@/lib/config";
import { sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { processRun } from "@/lib/pipeline";
import { createRun } from "@/lib/runs/create";
import { InMemoryRunStore } from "@/lib/runs/store";
import type { Principal } from "@/lib/security/auth";
import type { BudgetGuard } from "@/lib/security/budget";
import { LocalUploadStorage, type UploadStorage } from "@/lib/storage/uploads";
import { makeMinimalPdf } from "../unit/minimal-pdf";

const principal: Principal = { id: "guest:upload-owner", quotaKey: "ip:upload-owner", kind: "guest" };
const config = getConfig({
  NODE_ENV: "test",
  SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough",
  IP_HASH_SECRET: "test-ip-hash-secret"
});

async function uploaded(storage: LocalUploadStorage, bytes: Uint8Array) {
  const sha256 = sha256Hex(bytes);
  const presigned = await storage.presign({ filename: "source.pdf", size_bytes: bytes.byteLength, sha256 }, {
    ownerId: principal.id,
    quotaKey: principal.quotaKey,
    principalKind: principal.kind,
    origin: "http://localhost:3000"
  });
  const token = new URL(presigned.upload_url).pathname.split("/").at(-1)!;
  await storage.acceptPut(token, new Request(presigned.upload_url, {
    method: "PUT", headers: { "content-type": "application/pdf" }, body: Buffer.from(bytes)
  }));
  return { ...presigned, sha256, token };
}

describe("incoming upload lifecycle", () => {
  it("atomically limits outstanding grants while expired grants still count toward daily issuance", async () => {
    let clock = Date.parse("2026-09-02T00:00:00Z");
    const quotaConfig = getConfig({
      NODE_ENV: "test",
      SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough",
      GUEST_UPLOAD_DOCUMENTS_PER_DAY: "6"
    });
    const storage = new LocalUploadStorage(quotaConfig.SESSION_SIGNING_SECRET, () => clock, quotaConfig);
    const request = { filename: "quota.pdf", size_bytes: 1_000, sha256: "a".repeat(64) };
    const context = {
      ownerId: principal.id, quotaKey: principal.quotaKey, principalKind: principal.kind,
      origin: "http://localhost:3000"
    };
    for (let index = 0; index < 5; index += 1) await storage.presign(request, context);
    await expect(storage.presign(request, context)).rejects.toMatchObject({
      code: "RATE_LIMITED", httpStatus: 429
    });

    clock += 11 * 60_000;
    expect(await storage.sweepExpiredIncoming(new Date(clock), 10)).toHaveLength(5);
    await expect(storage.presign(request, context)).resolves.toMatchObject({ method: "PUT" });
    clock += 11 * 60_000;
    await storage.sweepExpiredIncoming(new Date(clock), 10);
    await expect(storage.presign(request, context)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("enforces a global daily upload-byte cap across owners and quota keys", async () => {
    const quotaConfig = getConfig({
      NODE_ENV: "test",
      SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough",
      GLOBAL_UPLOAD_BYTES_PER_DAY: "1500"
    });
    const storage = new LocalUploadStorage(quotaConfig.SESSION_SIGNING_SECRET, () =>
      Date.parse("2026-09-02T00:00:00Z"), quotaConfig);
    await storage.presign({ filename: "first.pdf", size_bytes: 1_000, sha256: "a".repeat(64) }, {
      ownerId: "guest:first", quotaKey: "ip:first", principalKind: "guest", origin: "http://localhost:3000"
    });
    await expect(storage.presign({
      filename: "second.pdf", size_bytes: 501, sha256: "b".repeat(64)
    }, {
      ownerId: "guest:second", quotaKey: "ip:second", principalKind: "guest", origin: "http://localhost:3000"
    })).rejects.toMatchObject({ code: "RATE_LIMITED", httpStatus: 429 });
  });

  it("sweeps presign-only grants and rejects upload after expiry", async () => {
    let clock = Date.parse("2026-09-02T00:00:00Z");
    const storage = new LocalUploadStorage(config.SESSION_SIGNING_SECRET, () => clock);
    const bytes = makeMinimalPdf(["abandoned"]);
    const sha256 = sha256Hex(bytes);
    const presigned = await storage.presign({ filename: "abandoned.pdf", size_bytes: bytes.byteLength, sha256 }, {
      ownerId: principal.id, quotaKey: principal.quotaKey, principalKind: principal.kind,
      origin: "http://localhost:3000"
    });
    const token = new URL(presigned.upload_url).pathname.split("/").at(-1)!;
    clock = Date.parse(presigned.expires_at) + 5 * 60_000 + 1;
    expect(await storage.sweepExpiredIncoming(new Date(clock), 10)).toEqual([presigned.blob_path]);
    await expect(storage.acceptPut(token, new Request(presigned.upload_url, {
      method: "PUT", headers: { "content-type": "application/pdf" }, body: Buffer.from(bytes)
    }))).rejects.toMatchObject({ httpStatus: 410 });
  });

  it("uses an immutable SHA-bound stage and cannot replay a consumed incoming token", async () => {
    const storage = new LocalUploadStorage(config.SESSION_SIGNING_SECRET);
    const bytes = makeMinimalPdf(["one-use upload"]);
    const grant = await uploaded(storage, bytes);
    await storage.claimIncoming({
      ownerId: principal.id, runId: crypto.randomUUID(), blobPath: grant.blob_path,
      expectedSha256: grant.sha256, expectedSize: bytes.byteLength
    });
    const stage = "staging/test/0/source.pdf";
    await storage.stage(stage, bytes);
    expect(sha256Hex(await storage.read(stage))).toBe(grant.sha256);
    await storage.purgeIncomingToFence(grant.blob_path);
    await expect(storage.acceptPut(grant.token, new Request(grant.upload_url, {
      method: "PUT", headers: { "content-type": "application/pdf" }, body: Buffer.from(bytes)
    }))).rejects.toMatchObject({ httpStatus: 410 });
    await expect(storage.read(grant.blob_path)).rejects.toMatchObject({ code: "SOURCE_UNREACHABLE" });
  });

  it("allows only the same run to resume a claim after expiry and after fencing", async () => {
    let clock = Date.parse("2026-09-02T00:00:00Z");
    const storage = new LocalUploadStorage(config.SESSION_SIGNING_SECRET, () => clock);
    const bytes = makeMinimalPdf(["resumable claim"]);
    const grant = await uploaded(storage, bytes);
    const runId = crypto.randomUUID();
    const claim = {
      ownerId: principal.id,
      runId,
      blobPath: grant.blob_path,
      expectedSha256: grant.sha256,
      expectedSize: bytes.byteLength
    };
    await storage.claimIncoming(claim);
    clock = Date.parse(grant.expires_at) + 1;
    await expect(storage.claimIncoming(claim)).resolves.toBeUndefined();
    await storage.purgeIncomingToFence(grant.blob_path);
    await expect(storage.claimIncoming(claim)).resolves.toBeUndefined();
    await expect(storage.claimIncoming({ ...claim, runId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "UNSAFE_URL", httpStatus: 409 });
  });

  it.each(["budget", "schedule"] as const)("cleans a claimed upload when %s fails", async (failure) => {
    const storage = new LocalUploadStorage(config.SESSION_SIGNING_SECRET);
    const bytes = makeMinimalPdf(["cleanup on failed creation"]);
    const grant = await uploaded(storage, bytes);
    const store = new InMemoryRunStore();
    const budget: BudgetGuard = {
      reserve: async () => {
        if (failure === "budget") throw new AppError("BUDGET_EXCEEDED", "test rejection", { httpStatus: 402 });
      },
      settle: async () => undefined
    };
    const creation = createRun({ documents: [{ role: "base", source: {
      type: "upload", blob_path: grant.blob_path, sha256: grant.sha256,
      size_bytes: bytes.byteLength, filename: "source.pdf"
    } }] }, principal, null, {
      config, store, budget, uploadStorage: storage,
      schedule: async () => {
        if (failure === "schedule") throw new AppError("ANALYSIS_INCOMPLETE", "schedule failed");
        return null;
      }
    });
    await expect(creation).rejects.toMatchObject({
      code: failure === "budget" ? "BUDGET_EXCEEDED" : "ANALYSIS_INCOMPLETE"
    });
    await expect(storage.read(grant.blob_path)).rejects.toMatchObject({ code: "SOURCE_UNREACHABLE" });
    expect(await store.listExpired(new Date("2100-01-01T00:00:00Z"))).toEqual([]);
  });

  it("preclaims and cleans every declared upload when the nth load fails", async () => {
    const bytes = makeMinimalPdf(["first source"]);
    const firstSha = sha256Hex(bytes);
    const secondSha = "b".repeat(64);
    const purged = new Set<string>();
    const storage: UploadStorage = {
      presign: async (): Promise<PresignUploadResponse> => { throw new Error("not used"); },
      claimIncoming: async () => undefined,
      read: async (path) => {
        if (path.endsWith("second.pdf")) throw new AppError("SOURCE_UNREACHABLE", "missing");
        return bytes.slice();
      },
      stage: async () => undefined,
      temporaryReadUrl: async () => { throw new Error("not used"); },
      purgeIncomingToFence: async (path) => { purged.add(path); },
      remove: async () => undefined,
      sweepExpiredIncoming: async () => []
    };
    const store = new InMemoryRunStore();
    const record = (await store.create({
      ownerId: principal.id, quotaKey: principal.quotaKey,
      input: { documents: [
        { role: "base", source: { type: "upload", blob_path: "incoming/test/first.pdf", sha256: firstSha, size_bytes: bytes.byteLength, filename: "first.pdf" } },
        { role: "amendment", source: { type: "upload", blob_path: "incoming/test/second.pdf", sha256: secondSha, size_bytes: bytes.byteLength, filename: "second.pdf" } }
      ] },
      idempotencyKey: null, reservedMicroUsd: 504_000
    })).record;
    const result = await processRun(record.id, { store, uploadStorage: storage, config });
    expect(result.status).toBe("failed");
    expect(purged).toEqual(new Set(["incoming/test/first.pdf", "incoming/test/second.pdf"]));
    expect(result.cleanupConfirmed).toBe(true);
  });

  it("deletes deterministic URL staging after a post-write crash window", async () => {
    const bytes = makeMinimalPdf(["URL staging crash window"]);
    const staged = new Set<string>();
    const removed = new Set<string>();
    const storage: UploadStorage = {
      presign: async (): Promise<PresignUploadResponse> => { throw new Error("not used"); },
      claimIncoming: async () => undefined,
      read: async () => { throw new Error("not used"); },
      stage: async (path) => {
        staged.add(path);
        throw new Error("worker terminated immediately after durable put");
      },
      temporaryReadUrl: async () => { throw new Error("not used"); },
      purgeIncomingToFence: async () => undefined,
      remove: async (path) => { staged.delete(path); removed.add(path); },
      sweepExpiredIncoming: async () => []
    };
    const store = new InMemoryRunStore();
    const record = (await store.create({
      ownerId: principal.id, quotaKey: principal.quotaKey,
      input: { documents: [{ role: "base", source: {
        type: "url", url: "https://canadabuys.canada.ca/crash.pdf"
      } }] },
      idempotencyKey: null, reservedMicroUsd: 499_500
    })).record;
    const fetcher = (async () => new Response(Buffer.from(bytes), {
      status: 200, headers: { "content-type": "application/pdf" }
    })) as typeof fetch;
    const result = await processRun(record.id, { store, uploadStorage: storage, config, fetcher });
    const deterministicPath = `staging/${record.id}/0/source.pdf`;
    expect(removed).toContain(deterministicPath);
    expect(staged).not.toContain(deterministicPath);
    expect(result.status).toBe("failed");
    expect(result.cleanupConfirmed).toBe(true);
    expect(result.result).toBeNull();
  });
});
