import {
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/lib/crypto";
import { createRailwayS3SafetyAttestation } from "@/lib/storage/railway-s3-safety";

interface FakeGrantRow {
  blobPath: string;
  ownerId: string;
  expectedSha256: string;
  expectedSize: number;
  status: string;
  claimedRunId: string | null;
  sourceEtag: string | null;
  stagePath: string | null;
  stageEtag: string | null;
  fenceEtag: string | null;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  version: number;
  cleanupAttempts: number;
  lastCleanupErrorCode: string | null;
  expiresAt: Date;
  cleanupDueAt: Date;
  hardDeleteBy: Date;
  sweepNow: Date;
  [key: string]: unknown;
}

const state = vi.hoisted(() => ({
  rows: [] as FakeGrantRow[],
  quotaRemaining: 1,
  quotaTransactions: [] as unknown[][],
  rawSql: [] as string[],
  presignCalls: [] as Array<{ command: unknown; options: unknown }>
}));

function promiseWithReturning<T>(value: T, returned: unknown[]) {
  const promise = Promise.resolve(value) as Promise<T> & { returning: () => Promise<unknown[]> };
  promise.returning = async () => returned;
  return promise;
}

vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => {
    const tagged = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      state.rawSql.push(strings.join("?"));
      return { strings, values };
    }) as {
      (strings: TemplateStringsArray, ...values: unknown[]): unknown;
      transaction: (queries: unknown[]) => Promise<unknown[][]>;
    };
    tagged.transaction = async (queries: unknown[]) => {
      state.quotaTransactions.push(queries);
      if (queries.length === 4) {
        const issued = state.quotaRemaining > 0 ? [{ id: crypto.randomUUID() }] : [];
        if (issued.length > 0) state.quotaRemaining -= 1;
        return [[], [], [], issued];
      }
      return queries.map(() => []);
    };
    return tagged;
  })
}));

vi.mock("drizzle-orm/neon-http", () => ({
  drizzle: vi.fn(() => ({
    query: {
      incomingUploads: {
        findFirst: vi.fn(async () => state.rows[0])
      }
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async (limit: number) => state.rows.slice(0, limit).map((row) => ({ ...row })))
        }))
      }))
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => {
          const row = state.rows[0];
          let returned: unknown[] = [];
          if (!row) return promiseWithReturning(undefined, returned);
          if (values.status === "claimed") {
            if (["issued", "uploaded"].includes(row.status) && row.expiresAt > new Date()) {
              row.status = "claimed";
              row.claimedRunId = values.claimedRunId as string;
              returned = [{ ...row }];
            }
          } else if (typeof values.leaseId === "string") {
            if (!row.leaseId || !row.leaseExpiresAt || row.leaseExpiresAt <= row.sweepNow) {
              row.leaseId = values.leaseId;
              row.leaseExpiresAt = values.leaseExpiresAt as Date;
              row.cleanupAttempts += 1;
              row.version += 1;
              returned = [{ ...row }];
            }
          } else if (values.leaseId === null) {
            row.leaseId = null;
            row.leaseExpiresAt = null;
            row.lastCleanupErrorCode = values.lastCleanupErrorCode as string;
            row.version += 1;
          } else if (values.status === "fenced") {
            row.status = "fenced";
            row.fenceEtag = values.fenceEtag as string;
            returned = [{ blobPath: row.blobPath }];
          } else {
            if (typeof values.sourceEtag === "string") row.sourceEtag = values.sourceEtag;
            if (typeof values.stagePath === "string") row.stagePath = values.stagePath;
            if (typeof values.stageEtag === "string") row.stageEtag = values.stageEtag;
          }
          return promiseWithReturning(undefined, returned);
        })
      }))
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => {
        const removed = state.rows.splice(0, 1);
        return promiseWithReturning(undefined, removed.map((row) => ({ blobPath: row.blobPath })));
      })
    }))
  }))
}));

interface FakeObject {
  bytes: Uint8Array;
  etag: string;
  contentType: string;
}

function preconditionError() {
  return Object.assign(new Error("precondition failed"), {
    name: "PreconditionFailed",
    $metadata: { httpStatusCode: 412 }
  });
}

function notFoundError() {
  return Object.assign(new Error("not found"), {
    name: "NotFound",
    $metadata: { httpStatusCode: 404 }
  });
}

class FakeS3Client {
  readonly objects = new Map<string, FakeObject>();
  readonly commands: unknown[] = [];
  deleteFailures = 0;
  versioningStatus: "Enabled" | "Suspended" | undefined;
  objectLockStatus: "absent" | "empty" | "ambiguous" | "Enabled" | "Disabled" | "unsupported" = "absent";
  retainDeletedVersion = false;
  private etagSequence = 0;

  async send(command: PutObjectCommand | GetObjectCommand | HeadObjectCommand | DeleteObjectCommand |
    GetBucketCorsCommand | GetBucketVersioningCommand | GetObjectLockConfigurationCommand |
    ListObjectVersionsCommand) {
    this.commands.push(command);
    if (command instanceof GetBucketVersioningCommand) return { Status: this.versioningStatus };
    if (command instanceof GetObjectLockConfigurationCommand) {
      if (this.objectLockStatus === "empty") return {};
      if (this.objectLockStatus === "ambiguous") return { ObjectLockConfiguration: {} };
      if (this.objectLockStatus === "Enabled" || this.objectLockStatus === "Disabled") {
        return { ObjectLockConfiguration: { ObjectLockEnabled: this.objectLockStatus } };
      }
      if (this.objectLockStatus === "unsupported") {
        throw Object.assign(new Error("not implemented"), {
          name: "NotImplemented",
          $metadata: { httpStatusCode: 501 }
        });
      }
      throw Object.assign(new Error("object lock configuration absent"), {
        name: "ObjectLockConfigurationNotFoundError",
        $metadata: { httpStatusCode: 404 }
      });
    }
    if (command instanceof GetBucketCorsCommand) {
      return {
        CORSRules: [{
          AllowedOrigins: ["https://rfp.example"],
          AllowedMethods: ["PUT", "GET", "HEAD"],
          AllowedHeaders: ["content-type", "content-length", "if-none-match"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 300
        }]
      };
    }
    if (command instanceof ListObjectVersionsCommand) {
      return {
        IsTruncated: false,
        Versions: this.retainDeletedVersion ? [{ Key: command.input.Prefix, VersionId: "old" }] : []
      };
    }
    const input = command.input;
    const key = input.Key!;
    if (command instanceof HeadObjectCommand) {
      const object = this.objects.get(key);
      if (!object) throw notFoundError();
      return {
        ContentLength: object.bytes.byteLength,
        ContentType: object.contentType,
        ETag: object.etag
      };
    }
    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(key);
      if (!object) throw notFoundError();
      if (command.input.IfMatch && command.input.IfMatch !== object.etag) throw preconditionError();
      return {
        ContentLength: object.bytes.byteLength,
        ContentType: object.contentType,
        ETag: object.etag,
        Body: {
          transformToByteArray: async () => Uint8Array.from(object.bytes)
        }
      };
    }
    if (command instanceof PutObjectCommand) {
      const existing = this.objects.get(key);
      if (command.input.IfNoneMatch === "*" && existing) throw preconditionError();
      if (command.input.IfMatch && command.input.IfMatch !== existing?.etag) throw preconditionError();
      const body = command.input.Body instanceof Uint8Array
        ? Uint8Array.from(command.input.Body)
        : new Uint8Array();
      if (command.input.ContentLength !== body.byteLength) throw new Error("content length mismatch");
      const etag = `\"etag-${++this.etagSequence}\"`;
      this.objects.set(key, {
        bytes: body,
        etag,
        contentType: command.input.ContentType ?? "application/octet-stream"
      });
      return { ETag: etag };
    }
    if (this.deleteFailures > 0) {
      this.deleteFailures -= 1;
      throw new Error("transient delete failure");
    }
    const existing = this.objects.get(key);
    if (command.input.IfMatch && command.input.IfMatch !== existing?.etag) throw preconditionError();
    this.objects.delete(key);
    return {};
  }

  asClient() {
    return this as unknown as S3Client;
  }
}

import {
  probeRailwayS3ControlPlane,
  probeRailwayS3ReplayFence,
  RailwayS3UploadStorage,
  type RailwayS3Presigner,
  type RailwayS3StorageConfig
} from "@/lib/storage/railway-s3";

const now = new Date("2026-09-03T12:00:00.000Z");
const config: RailwayS3StorageConfig = {
  databaseUrl: "postgresql://test.invalid/db",
  endpoint: "https://t3.storageapi.dev",
  region: "iad",
  bucket: "rfp-xray-private",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  namespaceSecret: "test-session-signing-secret-that-is-long-enough",
  forcePathStyle: false,
  MAX_OUTSTANDING_UPLOAD_GRANTS: 5,
  GUEST_UPLOAD_DOCUMENTS_PER_DAY: 15,
  API_UPLOAD_DOCUMENTS_PER_DAY: 150,
  GUEST_UPLOAD_BYTES_PER_DAY: 375 * 1024 * 1024,
  API_UPLOAD_BYTES_PER_DAY: 3_750 * 1024 * 1024,
  GLOBAL_UPLOAD_BYTES_PER_DAY: 5 * 1024 * 1024 * 1024
};

function makePresigner(url = "https://rfp-xray-private.storage.railway.test/signed") {
  return vi.fn<RailwayS3Presigner>(async (_client, command, options) => {
    state.presignCalls.push({ command, options });
    return url;
  });
}

function grantRow(blobPath: string, overrides: Partial<FakeGrantRow> = {}): FakeGrantRow {
  const bytes = new TextEncoder().encode("verified-pdf");
  return {
    blobPath,
    ownerId: "owner",
    expectedSha256: sha256Hex(bytes),
    expectedSize: bytes.byteLength,
    status: "claimed",
    claimedRunId: "0d20b7aa-48c2-4514-a401-5d4ea180074f",
    sourceEtag: null,
    stagePath: null,
    stageEtag: null,
    fenceEtag: null,
    leaseId: null,
    leaseExpiresAt: null,
    version: 0,
    cleanupAttempts: 0,
    lastCleanupErrorCode: null,
    expiresAt: new Date("2100-01-01T00:00:00.000Z"),
    cleanupDueAt: new Date("2026-09-03T11:00:00.000Z"),
    hardDeleteBy: new Date("2026-09-03T11:30:00.000Z"),
    sweepNow: now,
    ...overrides
  };
}

describe("Railway S3 upload storage", () => {
  beforeEach(() => {
    state.rows.length = 0;
    state.quotaRemaining = 1;
    state.quotaTransactions.length = 0;
    state.rawSql.length = 0;
    state.presignCalls.length = 0;
    vi.restoreAllMocks();
  });

  it("durably admits one grant and signs exact PUT constraints for no-overwrite replay protection", async () => {
    const client = new FakeS3Client();
    const presign = makePresigner();
    const storage = new RailwayS3UploadStorage(config, {
      client: client.asClient(),
      presign,
      now: () => now
    });
    const input = { filename: "source.pdf", size_bytes: 1_000, sha256: "a".repeat(64) };
    const context = {
      ownerId: "guest:quota",
      quotaKey: "ip:quota",
      principalKind: "guest" as const,
      origin: "https://rfp.example"
    };
    const results = await Promise.allSettled([
      storage.presign(input, context),
      storage.presign(input, context)
    ]);
    const fulfilled = results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof storage.presign>>>;
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;

    expect(rejected.reason).toMatchObject({ code: "RATE_LIMITED", httpStatus: 429 });
    expect(new Date(fulfilled.value.expires_at).getTime() - now.getTime()).toBe(300_000);
    expect(fulfilled.value.headers).toEqual({
      "content-type": "application/pdf",
      "content-length": "1000",
      "if-none-match": "*"
    });
    expect(presign).toHaveBeenCalledOnce();
    const signed = state.presignCalls[0];
    expect(signed.options).toMatchObject({ expiresIn: 300 });
    expect((signed.options as { signableHeaders: Set<string> }).signableHeaders).toEqual(
      new Set(["content-length", "content-type", "if-none-match"])
    );
    expect((signed.command as PutObjectCommand).input).toMatchObject({
      Bucket: config.bucket,
      ContentLength: 1_000,
      ContentType: "application/pdf",
      IfNoneMatch: "*"
    });
    expect(state.quotaTransactions).toHaveLength(2);
    expect(state.quotaTransactions.every((queries) => queries.length === 4)).toBe(true);
  });

  it("requires an exact current attestation when the production adapter gate is enabled", () => {
    const safetyAttestation = createRailwayS3SafetyAttestation({
      target: config,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      objectLock: "absent",
      objectVersions: "verified_empty",
      corsExpectedOrigins: ["https://rfp.example"],
      corsRules: [{
        allowed_origins: ["https://rfp.example"],
        allowed_methods: ["GET", "HEAD", "PUT"],
        allowed_headers: ["content-type", "if-none-match"],
        exposed_headers: ["etag"],
        max_age_seconds: 300
      }]
    });
    const guarded = {
      ...config,
      requireSafetyAttestation: true,
      safetyAttestation,
      corsAllowedOrigins: ["https://rfp.example"]
    };
    expect(() => new RailwayS3UploadStorage(guarded, { now: () => now })).not.toThrow();
    expect(() => new RailwayS3UploadStorage({
      ...guarded,
      bucket: "changed-after-probe"
    }, { now: () => now })).toThrow(/attestation.*target_mismatch/i);
    expect(() => new RailwayS3UploadStorage(guarded, {
      now: () => new Date(now.getTime() + 2 * 60 * 60_000)
    })).toThrow(/attestation.*expired/i);
    const attacker = {
      ...guarded,
      endpoint: "https://credential-sink.example",
      safetyAttestation: createRailwayS3SafetyAttestation({
        target: { ...guarded, endpoint: "https://credential-sink.example" },
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 60 * 60_000),
        objectLock: "absent",
        objectVersions: "verified_empty",
        corsExpectedOrigins: ["https://rfp.example"],
        corsRules: [{
          allowed_origins: ["https://rfp.example"],
          allowed_methods: ["GET", "HEAD", "PUT"],
          allowed_headers: ["content-type", "if-none-match"],
          exposed_headers: ["etag"],
          max_age_seconds: 300
        }]
      })
    };
    expect(() => new RailwayS3UploadStorage(attacker, { now: () => now }))
      .toThrow(/storageapi\.dev/i);
  });

  it("uses SigV4 signed headers for the exact browser-controlled request", async () => {
    const storage = new RailwayS3UploadStorage(config, { now: () => now });
    const result = await storage.presign({
      filename: "source.pdf",
      size_bytes: 321,
      sha256: "b".repeat(64)
    }, {
      ownerId: "guest:sigv4",
      quotaKey: "ip:sigv4",
      principalKind: "guest",
      origin: "https://rfp.example"
    });
    const url = new URL(result.upload_url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual([
      "content-length",
      "content-type",
      "host",
      "if-none-match"
    ]);
  });

  it("verifies claimed source size, media type, SHA-256, and reads one immutable ETag snapshot", async () => {
    const client = new FakeS3Client();
    const path = "incoming/owner/grant/source.pdf";
    const bytes = new TextEncoder().encode("verified-pdf");
    state.rows.push(grantRow(path));
    client.objects.set(path, { bytes, etag: "\"source-etag\"", contentType: "application/pdf" });
    const storage = new RailwayS3UploadStorage(config, { client: client.asClient(), now: () => now });

    await expect(storage.read(path)).resolves.toEqual(bytes);
    const get = client.commands.find((command) => command instanceof GetObjectCommand) as GetObjectCommand;
    expect(get.input.IfMatch).toBe("\"source-etag\"");
    expect(state.rows[0].sourceEtag).toBe("\"source-etag\"");

    client.objects.set(path, {
      bytes: new TextEncoder().encode("wrong-source"),
      etag: "\"wrong-etag\"",
      contentType: "application/pdf"
    });
    await expect(storage.read(path)).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA", httpStatus: 422 });
  });

  it("writes an immutable stage and only accepts an existing byte-identical object", async () => {
    const client = new FakeS3Client();
    const sourcePath = "incoming/owner/grant/source.pdf";
    const stagePath = "staging/run/0/source.pdf";
    const bytes = new TextEncoder().encode("verified-pdf");
    state.rows.push(grantRow(sourcePath));
    client.objects.set(sourcePath, { bytes, etag: "\"source-etag\"", contentType: "application/pdf" });
    const storage = new RailwayS3UploadStorage(config, { client: client.asClient(), now: () => now });

    await storage.read(sourcePath);
    await expect(storage.stage(stagePath, bytes, sourcePath)).resolves.toBeUndefined();
    await expect(storage.stage(stagePath, bytes, sourcePath)).resolves.toBeUndefined();
    const puts = client.commands.filter((command) => command instanceof PutObjectCommand) as PutObjectCommand[];
    expect(puts.every((command) => command.input.IfNoneMatch === "*")).toBe(true);
    expect(state.rows[0]).toMatchObject({ stagePath, sourceEtag: "\"source-etag\"" });

    client.objects.set(stagePath, {
      bytes: new TextEncoder().encode("different"),
      etag: "\"different-etag\"",
      contentType: "application/pdf"
    });
    await expect(storage.stage(stagePath, bytes, sourcePath)).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA",
      httpStatus: 409
    });
  });

  it("replaces raw bytes with a zero-byte ETag CAS fence and conditionally verifies deletion", async () => {
    const client = new FakeS3Client();
    const path = "incoming/owner/claimed/source.pdf";
    const row = grantRow(path);
    state.rows.push(row);
    client.objects.set(path, {
      bytes: new TextEncoder().encode("raw-source"),
      etag: "\"raw-etag\"",
      contentType: "application/pdf"
    });
    const storage = new RailwayS3UploadStorage(config, { client: client.asClient(), now: () => now });

    await storage.purgeIncomingToFence(path, row.claimedRunId!);
    expect(client.objects.get(path)?.bytes.byteLength).toBe(0);
    const fencePut = client.commands.find((command) =>
      command instanceof PutObjectCommand && command.input.ContentLength === 0
    ) as PutObjectCommand;
    expect(fencePut.input).toMatchObject({ IfMatch: "\"raw-etag\"", ContentLength: 0 });
    expect(state.rows[0].status).toBe("fenced");

    await storage.remove(path);
    expect(client.objects.has(path)).toBe(false);
    const deletion = client.commands.find((command) => command instanceof DeleteObjectCommand) as DeleteObjectCommand;
    expect(deletion.input.IfMatch).toMatch(/^"etag-/);
  });

  it("uses a Neon CAS lease so concurrent sweepers delete an expired object once", async () => {
    const client = new FakeS3Client();
    const path = "incoming/owner/expired/source.pdf";
    state.rows.push(grantRow(path, {
      status: "issued",
      claimedRunId: null,
      expiresAt: new Date("2026-09-03T11:00:00.000Z")
    }));
    client.objects.set(path, {
      bytes: new TextEncoder().encode("expired"),
      etag: "\"expired-etag\"",
      contentType: "application/pdf"
    });
    const storage = new RailwayS3UploadStorage(config, { client: client.asClient(), now: () => now });

    const results = await Promise.all([
      storage.sweepExpiredIncoming(now, 10),
      storage.sweepExpiredIncoming(now, 10)
    ]);
    expect(results.flat()).toEqual([path]);
    expect(state.rows).toHaveLength(0);
    expect(client.objects.has(path)).toBe(false);
    expect(state.rawSql.some((statement) =>
      statement.includes("DELETE FROM upload_quota_events") && statement.includes("LIMIT")
    )).toBe(true);
  });

  it("probes signed replay rejection, CAS fencing, and deletion without returning secrets", async () => {
    const client = new FakeS3Client();
    let signedPut: PutObjectCommand | undefined;
    const presign: RailwayS3Presigner = async (_client, command) => {
      if (command instanceof PutObjectCommand) signedPut = command;
      return "https://rfp-xray-private.storage.railway.test/probe?signed=redacted";
    };
    const fetchImpl: typeof fetch = async (_input, init) => {
      const command = signedPut!;
      const headers = new Headers(init?.headers);
      const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
      if (headers.get("content-length") !== String(command.input.ContentLength) ||
        headers.get("content-type") !== command.input.ContentType ||
        headers.get("if-none-match") !== command.input.IfNoneMatch ||
        body.byteLength !== command.input.ContentLength) {
        return new Response(null, { status: 403 });
      }
      try {
        await client.send(new PutObjectCommand({ ...command.input, Body: body }));
        return new Response(null, { status: 200 });
      } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) {
          return new Response(null, { status: 412 });
        }
        throw error;
      }
    };

    const result = await probeRailwayS3ReplayFence(config, {
      client: client.asClient(),
      presign,
      fetch: fetchImpl,
      corsAllowedOrigins: ["https://rfp.example"],
      now: () => now
    });
    expect(result).toMatchObject({
      initialUploadAccepted: true,
      replayRejected: true,
      exactSizeStored: true,
      casFenceWritten: true,
      replayAfterFenceRejected: true,
      deleteConfirmed: true,
      bucketVersioningNeverEnabled: true,
      objectLockAbsentOrDisabled: true,
      objectVersions: "verified_empty",
      corsContractVerified: true,
      safetyAttestationExpiresAt: "2026-09-10T12:00:00.000Z"
    });
    expect(result.safetyAttestation).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(client.objects.size).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/credential|signed=|probe\//i);
  });

  it.each(["Enabled", "Suspended"] as const)("fails closed when Bucket versioning is %s", async (status) => {
    const client = new FakeS3Client();
    client.versioningStatus = status;
    await expect(probeRailwayS3ControlPlane(config, {
      client: client.asClient(),
      corsAllowedOrigins: ["https://rfp.example"]
    })).rejects.toThrow(/versioning/i);
  });

  it("fails closed when the Object Lock query is merely unsupported", async () => {
    const client = new FakeS3Client();
    client.objectLockStatus = "unsupported";
    await expect(probeRailwayS3ControlPlane(config, {
      client: client.asClient(),
      corsAllowedOrigins: ["https://rfp.example"]
    })).rejects.toThrow(/not implemented/i);
  });

  it("accepts Railway's documented empty Object Lock response but rejects ambiguity elsewhere", async () => {
    const unmanagedConfig = { ...config, endpoint: "https://storage.railway.test" };
    const empty = new FakeS3Client();
    empty.objectLockStatus = "empty";
    await expect(probeRailwayS3ControlPlane(unmanagedConfig, {
      client: empty.asClient(),
      corsAllowedOrigins: ["https://rfp.example"]
    })).rejects.toThrow(/managed \*\.storageapi\.dev/i);

    await expect(probeRailwayS3ControlPlane(config, {
      client: empty.asClient(),
      corsAllowedOrigins: ["https://rfp.example"]
    })).resolves.toMatchObject({ objectLock: "absent" });

    const railwayEmptyStructure = new FakeS3Client();
    railwayEmptyStructure.objectLockStatus = "ambiguous";
    await expect(probeRailwayS3ControlPlane(config, {
      client: railwayEmptyStructure.asClient(),
      corsAllowedOrigins: ["https://rfp.example"]
    })).resolves.toMatchObject({ objectLock: "absent" });

    const ambiguous = new FakeS3Client();
    ambiguous.objectLockStatus = "ambiguous";
    await expect(probeRailwayS3ControlPlane(unmanagedConfig, {
      client: ambiguous.asClient(),
      corsAllowedOrigins: ["https://rfp.example"]
    })).rejects.toThrow(/managed \*\.storageapi\.dev/i);
  });

  it("refuses an attestation when deletion leaves a retained object version", async () => {
    const client = new FakeS3Client();
    client.retainDeletedVersion = true;
    let signedPut: PutObjectCommand | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
      try {
        await client.send(new PutObjectCommand({ ...signedPut!.input, Body: body }));
        return new Response(null, { status: 200 });
      } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) {
          return new Response(null, { status: 412 });
        }
        throw error;
      }
    };
    await expect(probeRailwayS3ReplayFence(config, {
      client: client.asClient(),
      presign: async (_client, command) => {
        if (command instanceof PutObjectCommand) signedPut = command;
        return "https://rfp-xray-private.storage.railway.test/probe?signed=redacted";
      },
      fetch: fetchImpl,
      corsAllowedOrigins: ["https://rfp.example"]
    })).rejects.toThrow(/retained version/i);
  });
});
