import { del, get, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import type { PresignUploadRequest, PresignUploadResponse } from "@/contracts";
import { incomingUploads } from "@/db/schema";
import { getConfig, type AppConfig } from "@/lib/config";
import { sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { auditLog } from "@/lib/logging";
import { normalizeFilename, ownerUploadNamespace } from "@/lib/source-validation";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const GRANT_LIFETIME_MS = 5 * 60_000;
const GRANT_EXPIRY_GRACE_MS = 5 * 60_000;
const GRANT_HARD_DELETE_MS = 30 * 60_000;
const CLEANUP_LEASE_MS = 60_000;

interface PresignContext {
  ownerId: string;
  origin: string;
}

export interface UploadClaim {
  ownerId: string;
  runId: string;
  blobPath: string;
  expectedSha256: string;
  expectedSize: number;
}

export interface UploadStorage {
  presign(input: PresignUploadRequest, context: PresignContext): Promise<PresignUploadResponse>;
  claimIncoming(input: UploadClaim): Promise<void>;
  read(blobPath: string): Promise<Uint8Array>;
  stage(blobPath: string, bytes: Uint8Array, sourceBlobPath?: string): Promise<void>;
  temporaryReadUrl(blobPath: string, validUntil: Date): Promise<string>;
  purgeIncomingToFence(blobPath: string): Promise<void>;
  remove(blobPath: string): Promise<void>;
  sweepExpiredIncoming(now?: Date, limit?: number): Promise<string[]>;
}

type GrantStatus = "issued" | "uploaded" | "claimed" | "fenced" | "deleted";
interface LocalGrant {
  token: string;
  blobPath: string;
  ownerId: string;
  expectedSha256: string;
  expectedSize: number;
  expiresAt: number;
  status: GrantStatus;
  claimedRunId: string | null;
}

export function stagingBlobPath(runId: string, documentIndex: number) {
  return `staging/${runId}/${documentIndex}/source.pdf`;
}

export class LocalUploadStorage implements UploadStorage {
  private readonly grantsByToken = new Map<string, LocalGrant>();
  private readonly grantsByPath = new Map<string, LocalGrant>();
  private readonly objects = new Map<string, Uint8Array>();

  constructor(
    private readonly namespaceSecret = "rfp-xray-local-session-secret-do-not-use-in-production",
    private readonly now: () => number = () => Date.now()
  ) {}

  async presign(input: PresignUploadRequest, context: PresignContext): Promise<PresignUploadResponse> {
    normalizeFilename(input.filename);
    const token = crypto.randomUUID();
    const blobPath = `incoming/${ownerUploadNamespace(context.ownerId, this.namespaceSecret)}/${crypto.randomUUID()}/${input.sha256}.pdf`;
    const expiresAt = this.now() + GRANT_LIFETIME_MS;
    const grant: LocalGrant = {
      token,
      blobPath,
      ownerId: context.ownerId,
      expectedSha256: input.sha256,
      expectedSize: input.size_bytes,
      expiresAt,
      status: "issued",
      claimedRunId: null
    };
    this.grantsByToken.set(token, grant);
    this.grantsByPath.set(blobPath, grant);
    return {
      blob_path: blobPath,
      upload_url: new URL(`/api/v1/uploads/local/${token}`, context.origin).toString(),
      expires_at: new Date(expiresAt).toISOString(),
      method: "PUT",
      headers: { "content-type": "application/pdf" }
    };
  }

  async acceptPut(token: string, request: Request): Promise<void> {
    const grant = this.grantsByToken.get(token);
    if (!grant || grant.expiresAt <= this.now() || grant.status !== "issued") {
      throw new AppError("UNSAFE_URL", "The upload grant is invalid, expired, or already used.", {
        httpStatus: 410
      });
    }
    const contentLength = request.headers.get("content-length");
    const declaredLength = contentLength === null ? null : Number(contentLength);
    if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength !== grant.expectedSize) {
      throw new AppError("UNSUPPORTED_MEDIA", "The upload size does not match the signed request.", {
        httpStatus: 422
      });
    }
    if (!request.body) {
      throw new AppError("UNSUPPORTED_MEDIA", "The PDF upload body is empty.", { httpStatus: 422 });
    }
    const bytes = await readBoundedStream(request.body, grant.expectedSize);
    if (bytes.byteLength !== grant.expectedSize || sha256Hex(bytes) !== grant.expectedSha256) {
      throw new AppError("UNSUPPORTED_MEDIA", "The upload does not match its signed size and SHA-256.", {
        httpStatus: 422
      });
    }
    const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (type && type !== "application/pdf") {
      throw new AppError("UNSUPPORTED_MEDIA", "Only application/pdf uploads are accepted.", {
        httpStatus: 415
      });
    }
    this.objects.set(grant.blobPath, bytes.slice());
    grant.status = "uploaded";
  }

  async claimIncoming(input: UploadClaim): Promise<void> {
    const grant = this.grantsByPath.get(input.blobPath);
    const sameClaim = grant && ["claimed", "fenced"].includes(grant.status) &&
      grant.claimedRunId === input.runId && grant.ownerId === input.ownerId &&
      grant.expectedSha256 === input.expectedSha256 && grant.expectedSize === input.expectedSize;
    if (sameClaim) return;
    if (!grant || grant.expiresAt <= this.now() || grant.status !== "uploaded" ||
      grant.ownerId !== input.ownerId || grant.expectedSha256 !== input.expectedSha256 ||
      grant.expectedSize !== input.expectedSize) {
      throw new AppError("UNSAFE_URL", "The incoming upload grant cannot be claimed.", { httpStatus: 409 });
    }
    grant.status = "claimed";
    grant.claimedRunId = input.runId;
  }

  async read(blobPath: string): Promise<Uint8Array> {
    const bytes = this.objects.get(blobPath);
    if (!bytes) {
      throw new AppError("SOURCE_UNREACHABLE", "The uploaded PDF was not found.", { httpStatus: 404 });
    }
    return bytes.slice();
  }

  async stage(blobPath: string, bytes: Uint8Array): Promise<void> {
    const existing = this.objects.get(blobPath);
    if (existing && sha256Hex(existing) !== sha256Hex(bytes)) {
      throw new AppError("UNSUPPORTED_MEDIA", "Immutable staging path already contains different bytes.", {
        httpStatus: 409
      });
    }
    this.objects.set(blobPath, bytes.slice());
  }

  async temporaryReadUrl(): Promise<string> {
    throw new AppError(
      "MONID_PARSE_FAILED",
      "Local uploads cannot be exposed to the live parsing provider. Configure Private Blob.",
      { httpStatus: 503 }
    );
  }

  async purgeIncomingToFence(blobPath: string): Promise<void> {
    const grant = this.grantsByPath.get(blobPath);
    if (!grant || !["claimed", "fenced"].includes(grant.status)) {
      throw new Error("Incoming upload is not owned by an active claim.");
    }
    this.objects.delete(blobPath);
    grant.status = "fenced";
  }

  async remove(blobPath: string): Promise<void> {
    this.objects.delete(blobPath);
    if (this.objects.has(blobPath)) throw new Error("Local object remained after deletion.");
  }

  async sweepExpiredIncoming(now = new Date(this.now()), limit = 100): Promise<string[]> {
    const deleted: string[] = [];
    for (const grant of this.grantsByPath.values()) {
      if (deleted.length >= limit || grant.expiresAt + GRANT_EXPIRY_GRACE_MS > now.getTime() || grant.status === "deleted") continue;
      this.objects.delete(grant.blobPath);
      grant.status = "deleted";
      deleted.push(grant.blobPath);
      this.grantsByToken.delete(grant.token);
      this.grantsByPath.delete(grant.blobPath);
    }
    return deleted;
  }

  clear() {
    this.grantsByToken.clear();
    this.grantsByPath.clear();
    this.objects.clear();
  }
}

async function readBoundedStream(stream: ReadableStream<Uint8Array>, maximum: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximum || received > MAX_PDF_BYTES) {
        throw new AppError("FILE_TOO_LARGE", "The upload exceeds its signed size.", { httpStatus: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class VercelBlobUploadStorage implements UploadStorage {
  private readonly db;
  private readonly sourceEtags = new Map<string, string>();

  constructor(private readonly config: AppConfig = getConfig()) {
    if (!config.DATABASE_URL || (config.NODE_ENV === "production" && !config.BLOB_REPLAY_FENCE_VALIDATED)) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The durable upload ledger and replay fence are not production-ready.", {
        httpStatus: 503
      });
    }
    this.db = drizzle(neon(config.DATABASE_URL), { schema: { incomingUploads } });
  }

  private get token(): string | undefined {
    return this.config.BLOB_READ_WRITE_TOKEN;
  }

  private namespaceSecret() {
    return this.config.SESSION_SIGNING_SECRET ?? this.config.IP_HASH_SECRET ?? "";
  }

  async presign(input: PresignUploadRequest, context: PresignContext): Promise<PresignUploadResponse> {
    normalizeFilename(input.filename);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + GRANT_LIFETIME_MS);
    const cleanupDueAt = new Date(expiresAt.getTime() + GRANT_EXPIRY_GRACE_MS);
    const hardDeleteBy = new Date(now.getTime() + GRANT_HARD_DELETE_MS);
    const blobPath = `incoming/${ownerUploadNamespace(context.ownerId, this.namespaceSecret())}/${crypto.randomUUID()}/${input.sha256}.pdf`;
    await this.db.insert(incomingUploads).values({
      blobPath, ownerId: context.ownerId, expectedSha256: input.sha256,
      expectedSize: input.size_bytes, status: "issued", claimedRunId: null,
      sourceEtag: null, stagePath: null, stageEtag: null, fenceEtag: null,
      expiresAt, cleanupDueAt, hardDeleteBy, createdAt: now, updatedAt: now
    });
    let presignedUrl: string;
    try {
      const signed = await issueSignedToken({
        token: this.token, pathname: blobPath, operations: ["put"],
        validUntil: expiresAt.getTime(), allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: input.size_bytes
      });
      ({ presignedUrl } = await presignUrl(signed, {
        access: "private", operation: "put", pathname: blobPath,
        validUntil: expiresAt.getTime(), allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: input.size_bytes, allowOverwrite: false,
        addRandomSuffix: false, cacheControlMaxAge: 60
      }));
    } catch (error) {
      await this.db.delete(incomingUploads).where(eq(incomingUploads.blobPath, blobPath));
      throw error;
    }
    return {
      blob_path: blobPath, upload_url: presignedUrl, expires_at: expiresAt.toISOString(),
      method: "PUT", headers: { "content-type": "application/pdf" }
    };
  }

  async claimIncoming(input: UploadClaim): Promise<void> {
    const now = new Date();
    const [claimed] = await this.db.update(incomingUploads).set({
      status: "claimed", claimedRunId: input.runId, updatedAt: now
    }).where(and(
      eq(incomingUploads.blobPath, input.blobPath), eq(incomingUploads.ownerId, input.ownerId),
      eq(incomingUploads.expectedSha256, input.expectedSha256), eq(incomingUploads.expectedSize, input.expectedSize),
      inArray(incomingUploads.status, ["issued", "uploaded"]), gt(incomingUploads.expiresAt, now)
    )).returning();
    if (claimed) return;
    const existing = await this.db.query.incomingUploads.findFirst({
      where: eq(incomingUploads.blobPath, input.blobPath)
    });
    if (existing && ["claimed", "fenced"].includes(existing.status) && existing.claimedRunId === input.runId &&
      existing.ownerId === input.ownerId && existing.expectedSha256 === input.expectedSha256 &&
      existing.expectedSize === input.expectedSize) return;
    throw new AppError("UNSAFE_URL", "The incoming upload grant cannot be claimed.", { httpStatus: 409 });
  }

  async read(blobPath: string): Promise<Uint8Array> {
    const result = await this.readBlobSnapshot(blobPath, 15_000);
    if (!result) {
      throw new AppError("SOURCE_UNREACHABLE", "The uploaded PDF was not found.", { httpStatus: 404 });
    }
    if (blobPath.startsWith("incoming/")) {
      this.sourceEtags.set(blobPath, result.etag);
      await this.db.update(incomingUploads).set({ sourceEtag: result.etag, updatedAt: new Date() })
        .where(eq(incomingUploads.blobPath, blobPath));
    }
    return result.bytes;
  }

  private async readBlobSnapshot(blobPath: string, timeoutMs = 10_000) {
    const result = await get(blobPath, {
      access: "private", token: this.token, useCache: false, abortSignal: AbortSignal.timeout(timeoutMs)
    });
    if (!result) return null;
    if (result.statusCode === 304 || !result.stream) throw new Error("Blob returned an unusable cached response.");
    if ((result.blob.size ?? 0) > MAX_PDF_BYTES) {
      await result.stream.cancel();
      throw new AppError("FILE_TOO_LARGE", "The uploaded PDF exceeds 25 MB.", { httpStatus: 413 });
    }
    return {
      bytes: await readBoundedStream(result.stream, MAX_PDF_BYTES),
      etag: result.blob.etag
    };
  }

  async stage(blobPath: string, bytes: Uint8Array, sourceBlobPath?: string): Promise<void> {
    const expectedSha256 = sha256Hex(bytes);
    let writtenEtag: string | null = null;
    if (sourceBlobPath) {
      const sourceEtag = this.sourceEtags.get(sourceBlobPath);
      if (!sourceEtag) throw new Error("The immutable source ETag was not captured before staging.");
      // The bytes have already been read without cache and verified by size and
      // SHA-256.  Write those exact bytes to an immutable destination instead
      // of relying on provider-specific copy/ifMatch source semantics.
    }
    try {
      const staged = await put(blobPath, Buffer.from(bytes), {
        access: "private", token: this.token, addRandomSuffix: false,
        allowOverwrite: false, contentType: "application/pdf", cacheControlMaxAge: 60
      });
      writtenEtag = staged.etag;
    } catch (writeError) {
      const existing = await this.existingStageOrOriginalError(blobPath, bytes.byteLength, expectedSha256, writeError);
      writtenEtag = existing.etag;
    }
    const staged = await this.readBlobSnapshot(blobPath);
    if (!staged || staged.bytes.byteLength !== bytes.byteLength || sha256Hex(staged.bytes) !== expectedSha256) {
      throw new AppError("UNSUPPORTED_MEDIA", "The immutable staged object did not match the verified source bytes.", {
        httpStatus: 409
      });
    }
    writtenEtag = staged.etag || writtenEtag;
    if (sourceBlobPath) {
      await this.db.update(incomingUploads).set({
        sourceEtag: this.sourceEtags.get(sourceBlobPath), stagePath: blobPath,
        stageEtag: writtenEtag, updatedAt: new Date()
      }).where(eq(incomingUploads.blobPath, sourceBlobPath));
    }
  }

  private async existingStageOrOriginalError(
    blobPath: string,
    expectedSize: number,
    expectedSha256: string,
    writeError: unknown
  ) {
    let existing: Awaited<ReturnType<VercelBlobUploadStorage["readBlobSnapshot"]>>;
    try {
      existing = await this.readBlobSnapshot(blobPath);
    } catch {
      throw writeError;
    }
    if (!existing) throw writeError;
    if (existing.bytes.byteLength !== expectedSize || sha256Hex(existing.bytes) !== expectedSha256) {
      throw new AppError("UNSUPPORTED_MEDIA", "Immutable staging is occupied by different bytes.", {
        httpStatus: 409,
        cause: writeError
      });
    }
    return existing;
  }

  async temporaryReadUrl(blobPath: string, validUntil: Date): Promise<string> {
    const signed = await issueSignedToken({
      token: this.token, pathname: blobPath, operations: ["get"], validUntil: validUntil.getTime()
    });
    const { presignedUrl } = await presignUrl(signed, {
      access: "private", operation: "get", pathname: blobPath,
      validUntil: validUntil.getTime(), useCache: false
    });
    return presignedUrl;
  }

  async purgeIncomingToFence(blobPath: string): Promise<void> {
    let sourceEtag: string | undefined;
    const current = await get(blobPath, {
      access: "private", token: this.token, useCache: false,
      abortSignal: AbortSignal.timeout(10_000)
    });
    if (current && current.statusCode === 200) {
      sourceEtag = current.blob.etag;
      await current.stream.cancel();
      if (current.blob.size === 0) {
        this.sourceEtags.set(blobPath, sourceEtag);
        await this.db.update(incomingUploads).set({
          status: "fenced", fenceEtag: sourceEtag, updatedAt: new Date()
        }).where(eq(incomingUploads.blobPath, blobPath));
        return;
      }
    }
    try {
      const fenced = await put(blobPath, Buffer.alloc(0), {
        access: "private", token: this.token, addRandomSuffix: false,
        allowOverwrite: sourceEtag !== undefined,
        ifMatch: sourceEtag,
        contentType: "application/octet-stream", cacheControlMaxAge: 60
      });
      this.sourceEtags.set(blobPath, fenced.etag);
    } catch (error) {
      if (sourceEtag) throw error;
      // An upload may have won the absent-object race. Capture its ETag and
      // replace exactly that version; never perform an unconditional overwrite.
      const raced = await get(blobPath, {
        access: "private", token: this.token, useCache: false,
        abortSignal: AbortSignal.timeout(10_000)
      });
      if (!raced || raced.statusCode !== 200) throw error;
      const racedEtag = raced.blob.etag;
      await raced.stream.cancel();
      const fenced = await put(blobPath, Buffer.alloc(0), {
        access: "private", token: this.token, addRandomSuffix: false,
        allowOverwrite: true, ifMatch: racedEtag,
        contentType: "application/octet-stream", cacheControlMaxAge: 60
      });
      this.sourceEtags.set(blobPath, fenced.etag);
    }
    const remaining = await get(blobPath, {
      access: "private", token: this.token, useCache: false, abortSignal: AbortSignal.timeout(10_000)
    });
    if (!remaining || remaining.blob.size !== 0) {
      await remaining?.stream?.cancel();
      throw new Error("The incoming raw bytes were not replaced by the replay fence.");
    }
    await remaining.stream?.cancel();
    await this.db.update(incomingUploads).set({
      status: "fenced", fenceEtag: this.sourceEtags.get(blobPath) ?? null, updatedAt: new Date()
    })
      .where(eq(incomingUploads.blobPath, blobPath));
  }

  async remove(blobPath: string): Promise<void> {
    const current = await get(blobPath, {
      access: "private", token: this.token, useCache: false, abortSignal: AbortSignal.timeout(10_000)
    });
    if (!current) return;
    if (current.statusCode !== 200) throw new Error("Blob metadata could not be read for conditional deletion.");
    const etag = current.blob.etag;
    await current.stream.cancel();
    await del(blobPath, { token: this.token, ifMatch: etag });
    const remaining = await get(blobPath, {
      access: "private", token: this.token, useCache: false, abortSignal: AbortSignal.timeout(10_000)
    });
    if (remaining) {
      await remaining.stream?.cancel();
      throw new Error("Blob deletion could not be confirmed.");
    }
  }

  async sweepExpiredIncoming(now = new Date(), limit = 100): Promise<string[]> {
    const rows = await this.db.select().from(incomingUploads).where(and(
      lte(incomingUploads.cleanupDueAt, now),
      inArray(incomingUploads.status, ["issued", "uploaded", "claimed", "fenced"]),
      or(isNull(incomingUploads.leaseExpiresAt), lte(incomingUploads.leaseExpiresAt, now))
    )).limit(Math.max(1, Math.min(limit, 100)));
    const deleted: string[] = [];
    for (const row of rows) {
      const leaseId = crypto.randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + CLEANUP_LEASE_MS);
      const [leased] = await this.db.update(incomingUploads).set({
        leaseId,
        leaseExpiresAt,
        cleanupAttempts: sql`${incomingUploads.cleanupAttempts} + 1`,
        version: sql`${incomingUploads.version} + 1`,
        updatedAt: now
      }).where(and(
        eq(incomingUploads.blobPath, row.blobPath),
        eq(incomingUploads.version, row.version),
        lte(incomingUploads.cleanupDueAt, now),
        inArray(incomingUploads.status, ["issued", "uploaded", "claimed", "fenced"]),
        or(isNull(incomingUploads.leaseExpiresAt), lte(incomingUploads.leaseExpiresAt, now))
      )).returning();
      if (!leased) continue;
      try {
        await this.remove(row.blobPath);
        const removed = await this.db.delete(incomingUploads).where(and(
          eq(incomingUploads.blobPath, row.blobPath),
          eq(incomingUploads.leaseId, leaseId)
        )).returning({ blobPath: incomingUploads.blobPath });
        if (removed.length > 0) deleted.push(row.blobPath);
      } catch (error) {
        await this.db.update(incomingUploads).set({
          leaseId: null,
          leaseExpiresAt: null,
          lastCleanupErrorCode: error instanceof AppError ? error.code : "BLOB_DELETE_FAILED",
          version: sql`${incomingUploads.version} + 1`,
          updatedAt: now
        }).where(and(
          eq(incomingUploads.blobPath, row.blobPath),
          eq(incomingUploads.leaseId, leaseId)
        ));
        if (row.hardDeleteBy <= now) {
          auditLog("incoming_upload_cleanup_overdue", {
            resource_sha256: sha256Hex(row.blobPath),
            cleanup_attempts: leased.cleanupAttempts,
            overdue: true
          });
        }
      }
    }
    return deleted;
  }
}

let storageOverride: UploadStorage | undefined;
let localStorage: LocalUploadStorage | undefined;

export function setUploadStorageForTests(storage: UploadStorage | undefined) {
  storageOverride = storage;
}

export function getUploadStorage(config = getConfig()): UploadStorage {
  if (storageOverride) return storageOverride;
  if (config.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN) {
    return new VercelBlobUploadStorage(config);
  }
  if (config.NODE_ENV === "production") {
    throw new AppError("ANALYSIS_INCOMPLETE", "Private Blob storage is not configured.", {
      httpStatus: 503, retryable: true
    });
  }
  localStorage ??= new LocalUploadStorage(
    config.SESSION_SIGNING_SECRET ?? "rfp-xray-local-session-secret-do-not-use-in-production"
  );
  return localStorage;
}

export function getLocalUploadStorage(): LocalUploadStorage {
  const storage = getUploadStorage();
  if (!(storage instanceof LocalUploadStorage)) {
    throw new AppError("UNSUPPORTED_MEDIA", "The local upload endpoint is disabled.", { httpStatus: 404 });
  }
  return storage;
}

export function resetUploadStorageForTests() {
  localStorage?.clear();
  localStorage = undefined;
  storageOverride = undefined;
}
