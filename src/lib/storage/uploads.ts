import { del, get, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import type { PresignUploadRequest, PresignUploadResponse } from "@/contracts";
import { incomingUploads } from "@/db/schema";
import {
  getConfig,
  getPrivateStorageProvider,
  getRailwayS3CorsAllowedOrigins,
  getRailwayS3SafetyStatus,
  type AppConfig
} from "@/lib/config";
import { sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { auditLog } from "@/lib/logging";
import { normalizeFilename, ownerUploadNamespace } from "@/lib/source-validation";
import { RailwayS3UploadStorage } from "@/lib/storage/railway-s3";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const GRANT_LIFETIME_MS = 5 * 60_000;
const GRANT_EXPIRY_GRACE_MS = 5 * 60_000;
const GRANT_HARD_DELETE_MS = 30 * 60_000;
const CLEANUP_LEASE_MS = 60_000;
const QUOTA_EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const QUOTA_EVENT_CLEANUP_BATCH_SIZE = 1_000;

interface PresignContext {
  ownerId: string;
  quotaKey: string;
  principalKind: "guest" | "api";
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
  purgeIncomingToFence(blobPath: string, claimedRunId?: string): Promise<void>;
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

interface LocalQuotaEvent {
  quotaKey: string;
  sizeBytes: number;
  day: string;
  createdAt: number;
}

export function stagingBlobPath(runId: string, documentIndex: number) {
  return `staging/${runId}/${documentIndex}/source.pdf`;
}

export class LocalUploadStorage implements UploadStorage {
  private readonly grantsByToken = new Map<string, LocalGrant>();
  private readonly grantsByPath = new Map<string, LocalGrant>();
  private readonly objects = new Map<string, Uint8Array>();
  private readonly quotaEvents: LocalQuotaEvent[] = [];

  constructor(
    private readonly namespaceSecret = "rfp-xray-local-session-secret-do-not-use-in-production",
    private readonly now: () => number = () => Date.now(),
    private readonly config: AppConfig = getConfig()
  ) {}

  async presign(input: PresignUploadRequest, context: PresignContext): Promise<PresignUploadResponse> {
    normalizeFilename(input.filename);
    const now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const outstanding = [...this.grantsByPath.values()].filter((grant) =>
      grant.ownerId === context.ownerId && grant.expiresAt > now &&
      (grant.status === "issued" || grant.status === "uploaded")
    ).length;
    const quotaEvents = this.quotaEvents.filter((event) =>
      event.quotaKey === context.quotaKey && event.day === day
    );
    const documentLimit = context.principalKind === "api"
      ? this.config.API_UPLOAD_DOCUMENTS_PER_DAY
      : this.config.GUEST_UPLOAD_DOCUMENTS_PER_DAY;
    const byteLimit = context.principalKind === "api"
      ? this.config.API_UPLOAD_BYTES_PER_DAY
      : this.config.GUEST_UPLOAD_BYTES_PER_DAY;
    const quotaBytes = quotaEvents.reduce((total, event) => total + event.sizeBytes, 0);
    const globalBytes = this.quotaEvents
      .filter((event) => event.day === day)
      .reduce((total, event) => total + event.sizeBytes, 0);
    if (
      outstanding >= this.config.MAX_OUTSTANDING_UPLOAD_GRANTS ||
      quotaEvents.length >= documentLimit || quotaBytes + input.size_bytes > byteLimit ||
      globalBytes + input.size_bytes > this.config.GLOBAL_UPLOAD_BYTES_PER_DAY
    ) {
      throw new AppError("RATE_LIMITED", "The upload issuance quota has been reached.", {
        httpStatus: 429,
        retryable: true
      });
    }
    const token = crypto.randomUUID();
    const blobPath = `incoming/${ownerUploadNamespace(context.ownerId, this.namespaceSecret)}/${crypto.randomUUID()}/${input.sha256}.pdf`;
    const expiresAt = now + GRANT_LIFETIME_MS;
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
    this.quotaEvents.push({ quotaKey: context.quotaKey, sizeBytes: input.size_bytes, day, createdAt: now });
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
      "Local uploads cannot be exposed to the live parsing provider. Configure private object storage.",
      { httpStatus: 503 }
    );
  }

  async purgeIncomingToFence(blobPath: string, claimedRunId?: string): Promise<void> {
    const grant = this.grantsByPath.get(blobPath);
    if (!grant) {
      this.objects.delete(blobPath);
      return;
    }
    if (!["claimed", "fenced"].includes(grant.status) ||
      (claimedRunId !== undefined && grant.claimedRunId !== claimedRunId)) {
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
    const quotaCutoff = now.getTime() - QUOTA_EVENT_RETENTION_MS;
    for (let index = this.quotaEvents.length - 1; index >= 0; index -= 1) {
      if (this.quotaEvents[index].createdAt <= quotaCutoff) this.quotaEvents.splice(index, 1);
    }
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
    this.quotaEvents.length = 0;
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
  private readonly sqlClient: ReturnType<typeof neon>;
  private readonly sourceEtags = new Map<string, string>();

  constructor(private readonly config: AppConfig = getConfig()) {
    if (!config.DATABASE_URL || (config.NODE_ENV === "production" && !config.BLOB_REPLAY_FENCE_VALIDATED)) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The durable upload ledger and replay fence are not production-ready.", {
        httpStatus: 503
      });
    }
    this.sqlClient = neon(config.DATABASE_URL);
    this.db = drizzle(this.sqlClient, { schema: { incomingUploads } });
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
    const day = now.toISOString().slice(0, 10);
    const expiresAt = new Date(now.getTime() + GRANT_LIFETIME_MS);
    const cleanupDueAt = new Date(expiresAt.getTime() + GRANT_EXPIRY_GRACE_MS);
    const hardDeleteBy = new Date(now.getTime() + GRANT_HARD_DELETE_MS);
    const blobPath = `incoming/${ownerUploadNamespace(context.ownerId, this.namespaceSecret())}/${crypto.randomUUID()}/${input.sha256}.pdf`;
    const quotaEventId = crypto.randomUUID();
    const documentLimit = context.principalKind === "api"
      ? this.config.API_UPLOAD_DOCUMENTS_PER_DAY
      : this.config.GUEST_UPLOAD_DOCUMENTS_PER_DAY;
    const byteLimit = context.principalKind === "api"
      ? this.config.API_UPLOAD_BYTES_PER_DAY
      : this.config.GUEST_UPLOAD_BYTES_PER_DAY;
    const quotaTransaction = await this.sqlClient.transaction([
      this.sqlClient`SELECT pg_advisory_xact_lock(hashtext(${`rfp-xray-upload-global:${day}`}))`,
      this.sqlClient`SELECT pg_advisory_xact_lock(hashtext(${`rfp-xray-upload-quota:${context.quotaKey}:${day}`}))`,
      this.sqlClient`SELECT pg_advisory_xact_lock(hashtext(${`rfp-xray-upload-owner:${context.ownerId}`}))`,
      this.sqlClient`
        WITH permitted AS (
          SELECT 1
          WHERE (
            SELECT COUNT(*) FROM incoming_uploads
            WHERE owner_id = ${context.ownerId}
              AND status IN ('issued', 'uploaded')
              AND expires_at > ${now.toISOString()}::timestamptz
          ) < ${this.config.MAX_OUTSTANDING_UPLOAD_GRANTS}
          AND (
            SELECT COUNT(*) FROM upload_quota_events
            WHERE quota_key = ${context.quotaKey} AND day = ${day}
          ) < ${documentLimit}
          AND COALESCE((
            SELECT SUM(size_bytes) FROM upload_quota_events
            WHERE quota_key = ${context.quotaKey} AND day = ${day}
          ), 0) + ${input.size_bytes} <= ${byteLimit}
          AND COALESCE((
            SELECT SUM(size_bytes) FROM upload_quota_events WHERE day = ${day}
          ), 0) + ${input.size_bytes} <= ${this.config.GLOBAL_UPLOAD_BYTES_PER_DAY}
        ), issued AS (
          INSERT INTO incoming_uploads
            (blob_path, owner_id, expected_sha256, expected_size, status,
             claimed_run_id, source_etag, stage_path, stage_etag, fence_etag,
             expires_at, cleanup_due_at, hard_delete_by, created_at, updated_at)
          SELECT
            ${blobPath}, ${context.ownerId}, ${input.sha256}, ${input.size_bytes}, 'issued',
            NULL, NULL, NULL, NULL, NULL,
            ${expiresAt.toISOString()}::timestamptz,
            ${cleanupDueAt.toISOString()}::timestamptz,
            ${hardDeleteBy.toISOString()}::timestamptz,
            ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz
          FROM permitted
          RETURNING blob_path
        )
        INSERT INTO upload_quota_events
          (id, owner_id, quota_key, principal_kind, size_bytes, day, created_at)
        SELECT
          ${quotaEventId}::uuid, ${context.ownerId}, ${context.quotaKey},
          ${context.principalKind}, ${input.size_bytes}, ${day},
          ${now.toISOString()}::timestamptz
        FROM issued
        RETURNING id
      `
    ]);
    const issued = quotaTransaction[3] as unknown as Array<{ id: string }>;
    if (!issued[0]) {
      throw new AppError("RATE_LIMITED", "The upload issuance quota has been reached.", {
        httpStatus: 429,
        retryable: true
      });
    }
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
      await this.sqlClient.transaction([
        this.sqlClient`DELETE FROM incoming_uploads WHERE blob_path = ${blobPath}`,
        this.sqlClient`DELETE FROM upload_quota_events WHERE id = ${quotaEventId}::uuid`
      ]);
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

  async purgeIncomingToFence(blobPath: string, claimedRunId?: string): Promise<void> {
    const ledger = await this.db.query.incomingUploads.findFirst({
      where: eq(incomingUploads.blobPath, blobPath)
    });
    let sourceEtag: string | undefined;
    const current = await get(blobPath, {
      access: "private", token: this.token, useCache: false,
      abortSignal: AbortSignal.timeout(10_000)
    });
    if (!ledger) {
      // A path whose durable grant was already swept must never be recreated
      // as an untracked zero-byte fence. Remove any orphan that does exist;
      // if neither ledger nor object exists, cleanup is already complete.
      await current?.stream?.cancel();
      if (current) await this.remove(blobPath);
      return;
    }
    if (claimedRunId !== undefined &&
      (ledger.claimedRunId !== claimedRunId || !["claimed", "fenced"].includes(ledger.status))) {
      await current?.stream?.cancel();
      throw new Error("Incoming upload is not owned by the expected run claim.");
    }
    const now = new Date();
    if (ledger.expiresAt <= now) {
      await current?.stream?.cancel();
      if (current) await this.remove(blobPath);
      return;
    }
    if (current && current.statusCode === 200) {
      sourceEtag = current.blob.etag;
      await current.stream.cancel();
      if (current.blob.size === 0) {
        this.sourceEtags.set(blobPath, sourceEtag);
        const [updated] = await this.db.update(incomingUploads).set({
          status: "fenced", fenceEtag: sourceEtag, updatedAt: new Date()
        }).where(and(
          eq(incomingUploads.blobPath, blobPath),
          eq(incomingUploads.version, ledger.version),
          gt(incomingUploads.expiresAt, now)
        )).returning({ blobPath: incomingUploads.blobPath });
        if (!updated) await this.remove(blobPath);
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
    const [updated] = await this.db.update(incomingUploads).set({
      status: "fenced", fenceEtag: this.sourceEtags.get(blobPath) ?? null, updatedAt: new Date()
    }).where(and(
      eq(incomingUploads.blobPath, blobPath),
      eq(incomingUploads.version, ledger.version),
      gt(incomingUploads.expiresAt, now)
    )).returning({ blobPath: incomingUploads.blobPath });
    if (!updated) await this.remove(blobPath);
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
    const quotaCutoff = new Date(now.getTime() - QUOTA_EVENT_RETENTION_MS);
    await this.sqlClient`
      WITH expired AS (
        SELECT id
        FROM upload_quota_events
        WHERE created_at <= ${quotaCutoff.toISOString()}::timestamptz
        ORDER BY created_at, id
        LIMIT ${QUOTA_EVENT_CLEANUP_BATCH_SIZE}
      )
      DELETE FROM upload_quota_events AS events
      USING expired
      WHERE events.id = expired.id
    `;
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
  const provider = getPrivateStorageProvider(config);
  if (provider === "railway_s3") {
    const requireSafetyAttestation = config.NODE_ENV === "production";
    const safety = getRailwayS3SafetyStatus(config);
    if (!config.DATABASE_URL || !config.SESSION_SIGNING_SECRET ||
      (requireSafetyAttestation && !safety.valid)) {
      throw new AppError("ANALYSIS_INCOMPLETE", "Private S3 storage does not have a current safety attestation.", {
        httpStatus: 503,
        retryable: true
      });
    }
    return new RailwayS3UploadStorage({
      endpoint: config.S3_ENDPOINT!,
      region: config.S3_REGION!,
      bucket: config.S3_BUCKET!,
      accessKeyId: config.S3_ACCESS_KEY_ID!,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: config.S3_URL_STYLE === "path",
      databaseUrl: config.DATABASE_URL,
      namespaceSecret: config.SESSION_SIGNING_SECRET,
      requireSafetyAttestation,
      safetyAttestation: config.S3_SAFETY_ATTESTATION,
      corsAllowedOrigins: getRailwayS3CorsAllowedOrigins(config),
      MAX_OUTSTANDING_UPLOAD_GRANTS: config.MAX_OUTSTANDING_UPLOAD_GRANTS,
      GUEST_UPLOAD_DOCUMENTS_PER_DAY: config.GUEST_UPLOAD_DOCUMENTS_PER_DAY,
      API_UPLOAD_DOCUMENTS_PER_DAY: config.API_UPLOAD_DOCUMENTS_PER_DAY,
      GUEST_UPLOAD_BYTES_PER_DAY: config.GUEST_UPLOAD_BYTES_PER_DAY,
      API_UPLOAD_BYTES_PER_DAY: config.API_UPLOAD_BYTES_PER_DAY,
      GLOBAL_UPLOAD_BYTES_PER_DAY: config.GLOBAL_UPLOAD_BYTES_PER_DAY
    });
  }
  if (provider === "vercel_blob") {
    return new VercelBlobUploadStorage(config);
  }
  if (config.NODE_ENV === "production") {
    throw new AppError("ANALYSIS_INCOMPLETE", "Private object storage is not configured.", {
      httpStatus: 503, retryable: true
    });
  }
  localStorage ??= new LocalUploadStorage(
    config.SESSION_SIGNING_SECRET ?? "rfp-xray-local-session-secret-do-not-use-in-production",
    () => Date.now(),
    config
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
