import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "@/lib/config";
import { sha256Hex } from "@/lib/crypto";

interface FakeGrantRow {
  blobPath: string;
  ownerId: string;
  expectedSha256: string;
  expectedSize: number;
  status: string;
  claimedRunId: string | null;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  version: number;
  cleanupAttempts: number;
  lastCleanupErrorCode: string | null;
  sweepNow: Date;
  [key: string]: unknown;
}

const state = vi.hoisted(() => ({
  objects: new Map<string, { bytes: Uint8Array; etag: string }>(),
  rows: [] as FakeGrantRow[],
  stageLedgerCrash: false,
  deleteFailures: 0,
  putOptions: [] as Array<Record<string, unknown>>,
  getOptions: [] as Array<Record<string, unknown>>
}));

function promiseWithReturning<T>(value: T, returned: unknown[]) {
  const promise = Promise.resolve(value) as Promise<T> & { returning: () => Promise<unknown[]> };
  promise.returning = async () => returned;
  return promise;
}

vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/neon-http", () => ({
  drizzle: vi.fn(() => ({
    query: { incomingUploads: { findFirst: vi.fn(async () => state.rows[0]) } },
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({
      limit: vi.fn(async (limit: number) => state.rows.slice(0, limit).map((row) => ({ ...row })))
    })) })) })),
    update: vi.fn(() => ({ set: vi.fn((values: Record<string, unknown>) => ({
      where: vi.fn(() => {
        let returned: unknown[] = [];
        const row = state.rows[0];
        if (values.stagePath && state.stageLedgerCrash) {
          state.stageLedgerCrash = false;
          return promiseWithReturning(undefined, []).then(() => { throw new Error("ledger write interrupted"); });
        }
        if (row && typeof values.leaseId === "string") {
          if (!row.leaseId || !row.leaseExpiresAt || row.leaseExpiresAt <= row.sweepNow) {
            row.leaseId = values.leaseId;
            row.leaseExpiresAt = values.leaseExpiresAt as Date;
            row.cleanupAttempts += 1;
            row.version += 1;
            returned = [{ ...row }];
          }
        } else if (row && values.leaseId === null) {
          row.leaseId = null;
          row.leaseExpiresAt = null;
          row.lastCleanupErrorCode = values.lastCleanupErrorCode as string;
          row.version += 1;
        }
        return promiseWithReturning(undefined, returned);
      })
    })) })),
    delete: vi.fn(() => ({ where: vi.fn(() => {
      const removed = state.rows.splice(0, 1);
      return promiseWithReturning(undefined, removed.map((row) => ({ blobPath: row.blobPath })));
    }) }))
  }))
}));

vi.mock("@vercel/blob", () => ({
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
  put: vi.fn(async (path: string, body: Uint8Array, options: Record<string, unknown>) => {
    state.putOptions.push(options);
    const existing = state.objects.get(path);
    if (existing && !options.allowOverwrite) throw new Error("destination exists");
    if (existing && options.ifMatch !== existing.etag) throw new Error("etag mismatch");
    const stored = { bytes: Uint8Array.from(body), etag: `put-etag-${state.putOptions.length}` };
    state.objects.set(path, stored);
    return { etag: stored.etag };
  }),
  get: vi.fn(async (path: string, options: Record<string, unknown>) => {
    state.getOptions.push(options);
    const object = state.objects.get(path);
    if (!object) return null;
    return {
      statusCode: 200,
      blob: { size: object.bytes.byteLength, etag: object.etag },
      stream: new Blob([Uint8Array.from(object.bytes).buffer]).stream()
    };
  }),
  del: vi.fn(async (path: string) => {
    if (state.deleteFailures > 0) {
      state.deleteFailures -= 1;
      throw new Error("transient deletion failure");
    }
    state.objects.delete(path);
  })
}));

import { VercelBlobUploadStorage } from "@/lib/storage/uploads";

const config = getConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test.invalid/db",
  BLOB_READ_WRITE_TOKEN: "test-blob-token",
  SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough"
});

function grantRow(blobPath: string, now: Date): FakeGrantRow {
  return {
    blobPath,
    ownerId: "owner",
    expectedSha256: "a".repeat(64),
    expectedSize: 10,
    status: "issued",
    claimedRunId: null,
    sourceEtag: null,
    stagePath: null,
    stageEtag: null,
    fenceEtag: null,
    leaseId: null,
    leaseExpiresAt: null,
    version: 0,
    cleanupAttempts: 0,
    lastCleanupErrorCode: null,
    expiresAt: new Date(now.getTime() - 10 * 60_000),
    cleanupDueAt: new Date(now.getTime() - 5 * 60_000),
    hardDeleteBy: new Date(now.getTime() - 1),
    sweepNow: now,
    createdAt: new Date(now.getTime() - 20 * 60_000),
    updatedAt: now
  };
}

describe("Vercel Blob upload recovery", () => {
  beforeEach(() => {
    state.objects.clear();
    state.rows.length = 0;
    state.stageLedgerCrash = false;
    state.deleteFailures = 0;
    state.putOptions.length = 0;
    state.getOptions.length = 0;
    vi.restoreAllMocks();
  });

  it("writes verified bytes immutably and accepts an identical stage after a ledger crash", async () => {
    const storage = new VercelBlobUploadStorage(config);
    const sourcePath = "incoming/owner/grant/source.pdf";
    const stagePath = "staging/run/0/source.pdf";
    const bytes = new TextEncoder().encode("verified bytes");
    state.objects.set(sourcePath, { bytes, etag: "source-etag" });
    await storage.read(sourcePath);
    state.stageLedgerCrash = true;
    await expect(storage.stage(stagePath, bytes, sourcePath)).rejects.toThrow("ledger write interrupted");
    expect(state.objects.get(stagePath)?.bytes).toEqual(bytes);

    await expect(storage.stage(stagePath, bytes, sourcePath)).resolves.toBeUndefined();
    expect(state.putOptions).toHaveLength(2);
    expect(state.putOptions.every((options) => options.allowOverwrite === false)).toBe(true);
    expect(state.getOptions.every((options) => options.useCache === false)).toBe(true);

    state.objects.set(stagePath, { bytes: new TextEncoder().encode("different bytes"), etag: "other-etag" });
    await expect(storage.stage(stagePath, bytes, sourcePath)).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA",
      httpStatus: 409
    });
  });

  it("uses a CAS lease so concurrent sweepers delete one grant once", async () => {
    const storage = new VercelBlobUploadStorage(config);
    const now = new Date("2026-09-02T00:30:00Z");
    const path = "incoming/owner/expired/source.pdf";
    state.rows.push(grantRow(path, now));
    state.objects.set(path, { bytes: new TextEncoder().encode("expired"), etag: "expired-etag" });

    const results = await Promise.all([
      storage.sweepExpiredIncoming(now, 10),
      storage.sweepExpiredIncoming(now, 10)
    ]);
    expect(results.flat()).toEqual([path]);
    expect(state.rows).toHaveLength(0);
    expect(state.objects.has(path)).toBe(false);
  });

  it("allows only the owning run to resume an expired durable claim after fencing", async () => {
    const storage = new VercelBlobUploadStorage(config);
    const now = new Date("2026-09-02T00:30:00Z");
    const row = grantRow("incoming/owner/resume/source.pdf", now);
    row.status = "fenced";
    row.claimedRunId = "0d20b7aa-48c2-4514-a401-5d4ea180074f";
    row.expectedSha256 = "a".repeat(64);
    row.expectedSize = 10;
    state.rows.push(row);

    await expect(storage.claimIncoming({
      ownerId: "owner",
      runId: row.claimedRunId,
      blobPath: row.blobPath,
      expectedSha256: row.expectedSha256,
      expectedSize: row.expectedSize
    })).resolves.toBeUndefined();
    await expect(storage.claimIncoming({
      ownerId: "owner",
      runId: "e8ceeb46-1201-469a-a0f5-73e4568effd2",
      blobPath: row.blobPath,
      expectedSha256: row.expectedSha256,
      expectedSize: row.expectedSize
    })).rejects.toMatchObject({ code: "UNSAFE_URL", httpStatus: 409 });
  });

  it("creates the replay fence with source ETag CAS and treats an existing zero fence as a no-op", async () => {
    const storage = new VercelBlobUploadStorage(config);
    const path = "incoming/owner/claimed/source.pdf";
    state.objects.set(path, { bytes: new TextEncoder().encode("raw source"), etag: "raw-etag" });

    await storage.purgeIncomingToFence(path);
    expect(state.objects.get(path)?.bytes.byteLength).toBe(0);
    expect(state.putOptions).toHaveLength(1);
    expect(state.putOptions[0]).toMatchObject({ allowOverwrite: true, ifMatch: "raw-etag" });

    await storage.purgeIncomingToFence(path);
    expect(state.putOptions).toHaveLength(1);
  });

  it("releases a failed lease, logs only a hashed overdue identifier, and retries", async () => {
    const storage = new VercelBlobUploadStorage(config);
    const now = new Date("2026-09-02T00:30:00Z");
    const path = "incoming/owner/overdue/source.pdf";
    state.rows.push(grantRow(path, now));
    state.objects.set(path, { bytes: new TextEncoder().encode("expired"), etag: "expired-etag" });
    state.deleteFailures = 1;
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(await storage.sweepExpiredIncoming(now, 10)).toEqual([]);
    expect(state.rows[0]).toMatchObject({ leaseId: null, cleanupAttempts: 1 });
    expect(log).toHaveBeenCalledOnce();
    const emitted = String(log.mock.calls[0]?.[0]);
    expect(emitted).toContain(sha256Hex(path));
    expect(emitted).not.toContain(path);

    expect(await storage.sweepExpiredIncoming(new Date(now.getTime() + 1), 10)).toEqual([path]);
    expect(state.rows).toHaveLength(0);
  });
});
