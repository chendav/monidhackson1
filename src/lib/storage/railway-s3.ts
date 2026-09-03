import {
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectOutput
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { neon } from "@neondatabase/serverless";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import type { PresignUploadRequest, PresignUploadResponse } from "@/contracts";
import { incomingUploads } from "@/db/schema";
import type { AppConfig } from "@/lib/config";
import { sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { auditLog } from "@/lib/logging";
import { normalizeFilename, ownerUploadNamespace } from "@/lib/source-validation";
import {
  canonicalRailwayS3CorsOrigins,
  createRailwayS3SafetyAttestation,
  isRailwayManagedS3Endpoint,
  inspectRailwayS3SafetyAttestation,
  RAILWAY_S3_SAFETY_ATTESTATION_MAX_AGE_MS,
  verifyRailwayS3CorsContract,
  type RailwayS3CorsRule
} from "@/lib/storage/railway-s3-safety";
import type { UploadClaim, UploadStorage } from "@/lib/storage/uploads";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_SIGNED_URL_SECONDS = 5 * 60;
const GRANT_EXPIRY_GRACE_MS = 5 * 60_000;
const GRANT_HARD_DELETE_MS = 30 * 60_000;
const CLEANUP_LEASE_MS = 60_000;
const QUOTA_EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const QUOTA_EVENT_CLEANUP_BATCH_SIZE = 1_000;
const S3_COMMAND_TIMEOUT_MS = 8_000;

type UploadQuotaConfig = Pick<
  AppConfig,
  | "MAX_OUTSTANDING_UPLOAD_GRANTS"
  | "GUEST_UPLOAD_DOCUMENTS_PER_DAY"
  | "API_UPLOAD_DOCUMENTS_PER_DAY"
  | "GUEST_UPLOAD_BYTES_PER_DAY"
  | "API_UPLOAD_BYTES_PER_DAY"
  | "GLOBAL_UPLOAD_BYTES_PER_DAY"
>;

/**
 * Railway Buckets expose S3-compatible credentials. Keep this configuration
 * server-only: the browser receives only short-lived, narrowly signed URLs.
 */
export interface RailwayS3ConnectionConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export interface RailwayS3StorageConfig extends RailwayS3ConnectionConfig, UploadQuotaConfig {
  databaseUrl: string;
  namespaceSecret: string;
  requireSafetyAttestation?: boolean;
  safetyAttestation?: string;
  corsAllowedOrigins?: readonly string[];
}

interface PresignContext {
  ownerId: string;
  quotaKey: string;
  principalKind: "guest" | "api";
  origin: string;
}

type SignedCommand = PutObjectCommand | GetObjectCommand;
export type RailwayS3Presigner = (
  client: S3Client,
  command: SignedCommand,
  options: { expiresIn: number; signableHeaders?: Set<string> }
) => Promise<string>;

export interface RailwayS3StorageDependencies {
  client?: S3Client;
  presign?: RailwayS3Presigner;
  now?: () => Date;
}

export interface RailwayS3ReplayFenceProbeResult {
  initialUploadAccepted: true;
  replayRejected: true;
  exactSizeStored: true;
  casFenceWritten: true;
  replayAfterFenceRejected: true;
  deleteConfirmed: true;
  bucketVersioningNeverEnabled: true;
  objectLockAbsentOrDisabled: true;
  objectVersions: "verified_empty" | "listing_unsupported";
  corsContractVerified: true;
  safetyAttestation: string;
  safetyAttestationExpiresAt: string;
}

export interface RailwayS3ControlPlaneProbeResult {
  bucketVersioningNeverEnabled: true;
  objectLock: "absent" | "disabled";
  corsRules: RailwayS3CorsRule[];
}

interface ObjectSnapshot {
  bytes: Uint8Array;
  etag: string;
  contentType: string | undefined;
}

const defaultPresigner: RailwayS3Presigner = (client, command, options) => {
  if (command instanceof PutObjectCommand) return getSignedUrl(client, command, options);
  return getSignedUrl(client, command, options);
};

function validateConnectionConfig(config: RailwayS3ConnectionConfig) {
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new AppError("ANALYSIS_INCOMPLETE", "Railway object storage requires a credential-free HTTPS endpoint.", {
      httpStatus: 503
    });
  }
  if (!config.bucket || !config.region || !config.accessKeyId || !config.secretAccessKey) {
    throw new AppError("ANALYSIS_INCOMPLETE", "Railway object storage is not completely configured.", {
      httpStatus: 503
    });
  }
  if (!isRailwayManagedS3Endpoint(config.endpoint)) {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      "Railway object storage must use a managed *.storageapi.dev endpoint.",
      { httpStatus: 503 }
    );
  }
}

function validateStorageConfig(config: RailwayS3StorageConfig, now: Date) {
  validateConnectionConfig(config);
  if (!config.databaseUrl || config.namespaceSecret.length < 16) {
    throw new AppError("ANALYSIS_INCOMPLETE", "The durable Railway upload ledger is not completely configured.", {
      httpStatus: 503
    });
  }
  if (config.requireSafetyAttestation || process.env.NODE_ENV === "production") {
    const status = inspectRailwayS3SafetyAttestation(
      config.safetyAttestation,
      config,
      config.corsAllowedOrigins ?? [],
      now
    );
    if (!status.valid) {
      throw new AppError(
        "ANALYSIS_INCOMPLETE",
        `Railway object storage safety attestation is not current (${status.reason}).`,
        { httpStatus: 503, retryable: true }
      );
    }
  }
}

function createS3Client(config: RailwayS3ConnectionConfig) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    },
    forcePathStyle: config.forcePathStyle ?? false,
    maxAttempts: 1
  });
}

function isNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.$metadata?.httpStatusCode === 404 || candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" || candidate.Code === "NoSuchKey";
}

function isPreconditionFailed(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.$metadata?.httpStatusCode === 412 || candidate.name === "PreconditionFailed" ||
    candidate.Code === "PreconditionFailed";
}

function providerErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { name?: unknown; Code?: unknown; code?: unknown };
  for (const value of [candidate.Code, candidate.code, candidate.name]) {
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function isExplicitObjectLockAbsent(error: unknown) {
  return [
    "ObjectLockConfigurationNotFoundError",
    "NoSuchObjectLockConfiguration"
  ].includes(providerErrorCode(error) ?? "");
}

function isExplicitVersionListingUnsupported(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { $metadata?: { httpStatusCode?: unknown } };
  return candidate.$metadata?.httpStatusCode === 501 &&
    ["NotImplemented", "NotSupported"].includes(providerErrorCode(error) ?? "");
}

function requireEtag(etag: string | undefined) {
  if (!etag) throw new Error("Object storage did not return an ETag required for compare-and-swap.");
  return etag;
}

async function collectBoundedBody(body: GetObjectOutput["Body"], maximum: number): Promise<Uint8Array> {
  if (!body) throw new Error("Object storage returned an empty response body.");
  if (body instanceof Uint8Array) {
    if (body.byteLength > maximum) {
      throw new AppError("FILE_TOO_LARGE", "The uploaded PDF exceeds 25 MB.", { httpStatus: 413 });
    }
    return Uint8Array.from(body);
  }

  const candidate = body as unknown as {
    transformToByteArray?: () => Promise<Uint8Array>;
    getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
    [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
  };
  if (typeof candidate.getReader === "function") {
    const reader = candidate.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maximum) {
          throw new AppError("FILE_TOO_LARGE", "The uploaded PDF exceeds 25 MB.", { httpStatus: 413 });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return joinChunks(chunks, received);
  }
  if (typeof candidate[Symbol.asyncIterator] === "function") {
    const chunks: Uint8Array[] = [];
    let received = 0;
    for await (const chunk of candidate as AsyncIterable<Uint8Array | string>) {
      const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
      received += bytes.byteLength;
      if (received > maximum) {
        throw new AppError("FILE_TOO_LARGE", "The uploaded PDF exceeds 25 MB.", { httpStatus: 413 });
      }
      chunks.push(bytes);
    }
    return joinChunks(chunks, received);
  }
  if (typeof candidate.transformToByteArray === "function") {
    const bytes = await candidate.transformToByteArray();
    if (bytes.byteLength > maximum) {
      throw new AppError("FILE_TOO_LARGE", "The uploaded PDF exceeds 25 MB.", { httpStatus: 413 });
    }
    return bytes;
  }
  throw new Error("Object storage returned an unsupported response body.");
}

function joinChunks(chunks: Uint8Array[], total: number) {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * UploadStorage implementation for a private Railway Bucket. Durable grant,
 * quota, claim, and sweep state remains in Neon so multiple Vercel workers can
 * safely share the bucket without relying on process memory.
 */
export class RailwayS3UploadStorage implements UploadStorage {
  private readonly db;
  private readonly sqlClient: ReturnType<typeof neon>;
  private readonly client: S3Client;
  private readonly presignCommand: RailwayS3Presigner;
  private readonly now: () => Date;
  private readonly sourceEtags = new Map<string, string>();

  constructor(
    private readonly config: RailwayS3StorageConfig,
    dependencies: RailwayS3StorageDependencies = {}
  ) {
    this.now = dependencies.now ?? (() => new Date());
    validateStorageConfig(config, this.now());
    this.sqlClient = neon(config.databaseUrl);
    this.db = drizzle(this.sqlClient, { schema: { incomingUploads } });
    this.client = dependencies.client ?? createS3Client(config);
    this.presignCommand = dependencies.presign ?? defaultPresigner;
  }

  async presign(input: PresignUploadRequest, context: PresignContext): Promise<PresignUploadResponse> {
    normalizeFilename(input.filename);
    const now = this.now();
    const day = now.toISOString().slice(0, 10);
    const expiresAt = new Date(now.getTime() + MAX_SIGNED_URL_SECONDS * 1_000);
    const cleanupDueAt = new Date(expiresAt.getTime() + GRANT_EXPIRY_GRACE_MS);
    const hardDeleteBy = new Date(now.getTime() + GRANT_HARD_DELETE_MS);
    const blobPath = `incoming/${ownerUploadNamespace(context.ownerId, this.config.namespaceSecret)}/${crypto.randomUUID()}/${input.sha256}.pdf`;
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

    let uploadUrl: string;
    try {
      const command = new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: blobPath,
        ContentType: "application/pdf",
        ContentLength: input.size_bytes,
        IfNoneMatch: "*"
      });
      uploadUrl = await this.presignCommand(this.client, command, {
        expiresIn: MAX_SIGNED_URL_SECONDS,
        signableHeaders: new Set(["content-length", "content-type", "if-none-match"])
      });
      const parsed = new URL(uploadUrl);
      if (parsed.protocol !== "https:") throw new Error("Object storage returned a non-HTTPS upload URL.");
    } catch (error) {
      await this.sqlClient.transaction([
        this.sqlClient`DELETE FROM incoming_uploads WHERE blob_path = ${blobPath}`,
        this.sqlClient`DELETE FROM upload_quota_events WHERE id = ${quotaEventId}::uuid`
      ]);
      throw error;
    }

    return {
      blob_path: blobPath,
      upload_url: uploadUrl,
      expires_at: expiresAt.toISOString(),
      method: "PUT",
      headers: {
        "content-type": "application/pdf",
        "content-length": String(input.size_bytes),
        "if-none-match": "*"
      }
    };
  }

  async claimIncoming(input: UploadClaim): Promise<void> {
    const now = this.now();
    const [claimed] = await this.db.update(incomingUploads).set({
      status: "claimed",
      claimedRunId: input.runId,
      updatedAt: now
    }).where(and(
      eq(incomingUploads.blobPath, input.blobPath),
      eq(incomingUploads.ownerId, input.ownerId),
      eq(incomingUploads.expectedSha256, input.expectedSha256),
      eq(incomingUploads.expectedSize, input.expectedSize),
      inArray(incomingUploads.status, ["issued", "uploaded"]),
      gt(incomingUploads.expiresAt, now)
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
    const ledger = blobPath.startsWith("incoming/")
      ? await this.db.query.incomingUploads.findFirst({ where: eq(incomingUploads.blobPath, blobPath) })
      : undefined;
    if (blobPath.startsWith("incoming/") && (!ledger || ledger.status !== "claimed" || !ledger.claimedRunId)) {
      throw new AppError("UNSAFE_URL", "The incoming upload is not backed by an active claim.", { httpStatus: 409 });
    }
    const result = await this.readObjectSnapshot(blobPath, MAX_PDF_BYTES);
    if (!result) {
      throw new AppError("SOURCE_UNREACHABLE", "The uploaded PDF was not found.", { httpStatus: 404 });
    }
    if (result.contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/pdf") {
      throw new AppError("UNSUPPORTED_MEDIA", "The stored upload is not application/pdf.", { httpStatus: 415 });
    }
    if (ledger && (result.bytes.byteLength !== ledger.expectedSize || sha256Hex(result.bytes) !== ledger.expectedSha256)) {
      throw new AppError("UNSUPPORTED_MEDIA", "The upload does not match its signed size and SHA-256.", {
        httpStatus: 422
      });
    }
    if (ledger) {
      this.sourceEtags.set(blobPath, result.etag);
      await this.db.update(incomingUploads).set({ sourceEtag: result.etag, updatedAt: this.now() })
        .where(and(eq(incomingUploads.blobPath, blobPath), eq(incomingUploads.claimedRunId, ledger.claimedRunId!)));
    }
    return result.bytes;
  }

  private async headObject(blobPath: string) {
    try {
      return await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: blobPath
      }), { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  private async readObjectSnapshot(blobPath: string, maximum: number): Promise<ObjectSnapshot | null> {
    const head = await this.headObject(blobPath);
    if (!head) return null;
    const etag = requireEtag(head.ETag);
    if (typeof head.ContentLength !== "number" || head.ContentLength < 0) {
      throw new Error("Object storage omitted the object size.");
    }
    if (head.ContentLength > maximum) {
      throw new AppError("FILE_TOO_LARGE", "The uploaded PDF exceeds 25 MB.", { httpStatus: 413 });
    }
    let object;
    try {
      object = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: blobPath,
        IfMatch: etag
      }), { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    const bytes = await collectBoundedBody(object.Body, maximum);
    if (bytes.byteLength !== head.ContentLength) {
      throw new AppError("UNSUPPORTED_MEDIA", "Object storage returned a body with inconsistent size.", {
        httpStatus: 409
      });
    }
    return {
      bytes,
      etag: requireEtag(object.ETag ?? etag),
      contentType: object.ContentType ?? head.ContentType
    };
  }

  async stage(blobPath: string, bytes: Uint8Array, sourceBlobPath?: string): Promise<void> {
    const expectedSha256 = sha256Hex(bytes);
    if (sourceBlobPath && !this.sourceEtags.get(sourceBlobPath)) {
      throw new Error("The immutable source ETag was not captured before staging.");
    }
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: blobPath,
        Body: bytes,
        ContentType: "application/pdf",
        ContentLength: bytes.byteLength,
        IfNoneMatch: "*"
      }), { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) });
    } catch (error) {
      if (!isPreconditionFailed(error)) throw error;
      const existing = await this.readObjectSnapshot(blobPath, MAX_PDF_BYTES);
      if (!existing || existing.bytes.byteLength !== bytes.byteLength || sha256Hex(existing.bytes) !== expectedSha256) {
        throw new AppError("UNSUPPORTED_MEDIA", "Immutable staging is occupied by different bytes.", {
          httpStatus: 409,
          cause: error
        });
      }
    }

    const staged = await this.readObjectSnapshot(blobPath, MAX_PDF_BYTES);
    if (!staged || staged.bytes.byteLength !== bytes.byteLength || sha256Hex(staged.bytes) !== expectedSha256) {
      throw new AppError("UNSUPPORTED_MEDIA", "The immutable staged object did not match the verified source bytes.", {
        httpStatus: 409
      });
    }
    if (sourceBlobPath) {
      await this.db.update(incomingUploads).set({
        sourceEtag: this.sourceEtags.get(sourceBlobPath),
        stagePath: blobPath,
        stageEtag: staged.etag,
        updatedAt: this.now()
      }).where(eq(incomingUploads.blobPath, sourceBlobPath));
    }
  }

  async temporaryReadUrl(blobPath: string, validUntil: Date): Promise<string> {
    const remainingMs = validUntil.getTime() - this.now().getTime();
    const expiresIn = Math.floor(remainingMs / 1_000);
    if (expiresIn < 1 || expiresIn > MAX_SIGNED_URL_SECONDS) {
      throw new AppError("UNSAFE_URL", "The temporary read URL lifetime must be between 1 and 300 seconds.", {
        httpStatus: 400
      });
    }
    const url = await this.presignCommand(this.client, new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: blobPath,
      ResponseCacheControl: "private, no-store"
    }), { expiresIn });
    if (new URL(url).protocol !== "https:") {
      throw new Error("Object storage returned a non-HTTPS read URL.");
    }
    return url;
  }

  async purgeIncomingToFence(blobPath: string, claimedRunId?: string): Promise<void> {
    const ledger = await this.db.query.incomingUploads.findFirst({
      where: eq(incomingUploads.blobPath, blobPath)
    });
    let current = await this.headObject(blobPath);
    if (!ledger) {
      if (current) await this.remove(blobPath);
      return;
    }
    if (claimedRunId !== undefined &&
      (ledger.claimedRunId !== claimedRunId || !["claimed", "fenced"].includes(ledger.status))) {
      throw new Error("Incoming upload is not owned by the expected run claim.");
    }
    const now = this.now();
    if (ledger.expiresAt <= now) {
      if (current) await this.remove(blobPath);
      return;
    }
    if (current?.ContentLength === 0) {
      const fenceEtag = requireEtag(current.ETag);
      this.sourceEtags.set(blobPath, fenceEtag);
      await this.persistFenceOrRemove(blobPath, ledger.version, ledger.expiresAt, fenceEtag, now);
      return;
    }

    let fenceEtag: string;
    try {
      const fenced = await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: blobPath,
        Body: new Uint8Array(),
        ContentType: "application/octet-stream",
        ContentLength: 0,
        ...(current ? { IfMatch: requireEtag(current.ETag) } : { IfNoneMatch: "*" })
      }), { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) });
      fenceEtag = requireEtag(fenced.ETag);
    } catch (error) {
      if (!isPreconditionFailed(error)) throw error;
      current = await this.headObject(blobPath);
      if (!current) throw error;
      if (current.ContentLength === 0) {
        fenceEtag = requireEtag(current.ETag);
      } else {
        const raced = await this.client.send(new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: blobPath,
          Body: new Uint8Array(),
          ContentType: "application/octet-stream",
          ContentLength: 0,
          IfMatch: requireEtag(current.ETag)
        }), { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) });
        fenceEtag = requireEtag(raced.ETag);
      }
    }

    const remaining = await this.headObject(blobPath);
    if (!remaining || remaining.ContentLength !== 0 || requireEtag(remaining.ETag) !== fenceEtag) {
      throw new Error("The incoming raw bytes were not replaced by the replay fence.");
    }
    this.sourceEtags.set(blobPath, fenceEtag);
    await this.persistFenceOrRemove(blobPath, ledger.version, ledger.expiresAt, fenceEtag, now);
  }

  private async persistFenceOrRemove(
    blobPath: string,
    version: number,
    expiresAt: Date,
    fenceEtag: string,
    now: Date
  ) {
    const [updated] = await this.db.update(incomingUploads).set({
      status: "fenced",
      fenceEtag,
      updatedAt: now
    }).where(and(
      eq(incomingUploads.blobPath, blobPath),
      eq(incomingUploads.version, version),
      gt(incomingUploads.expiresAt, now),
      eq(incomingUploads.expiresAt, expiresAt)
    )).returning({ blobPath: incomingUploads.blobPath });
    if (!updated) await this.remove(blobPath);
  }

  async remove(blobPath: string): Promise<void> {
    const current = await this.headObject(blobPath);
    if (!current) return;
    const etag = requireEtag(current.ETag);
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: blobPath,
      IfMatch: etag,
      ...(current.VersionId ? { VersionId: current.VersionId } : {})
    }), { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) });
    const remaining = await this.headObject(blobPath);
    if (remaining) {
      throw new Error("Object deletion could not be confirmed.");
    }
  }

  async sweepExpiredIncoming(now = this.now(), limit = 100): Promise<string[]> {
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

/** Read-only provider control-plane checks shared by health tooling and the
 * destructive random-object probe. Any unsupported or ambiguous versioning,
 * Object Lock, or CORS response fails closed. */
export async function probeRailwayS3ControlPlane(
  config: RailwayS3ConnectionConfig,
  options: {
    client?: S3Client;
    corsAllowedOrigins?: readonly string[];
  } = {}
): Promise<RailwayS3ControlPlaneProbeResult> {
  validateConnectionConfig(config);
  const client = options.client ?? createS3Client(config);
  const expectedCorsOrigins = canonicalRailwayS3CorsOrigins(options.corsAllowedOrigins ?? []);
  if (expectedCorsOrigins.length === 0) {
    throw new Error("The S3 control-plane probe requires at least one expected CORS origin.");
  }
  const versioning = await client.send(
    new GetBucketVersioningCommand({ Bucket: config.bucket }),
    { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) }
  );
  if (versioning.Status !== undefined) {
    throw new Error(
      versioning.Status === "Enabled"
        ? "Bucket versioning is enabled."
        : "Bucket versioning was previously enabled and is now suspended; old versions may be retained."
    );
  }

  let objectLock: "absent" | "disabled";
  try {
    const lock = await client.send(
      new GetObjectLockConfigurationCommand({ Bucket: config.bucket }),
      { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) }
    );
    // Railway's documented unsupported Object Lock capability is represented
    // by a successful empty S3 response. Empty structures from other endpoint
    // families remain ambiguous/fail-closed below.
    if (!lock.ObjectLockConfiguration) {
      if (!isRailwayManagedS3Endpoint(config.endpoint)) {
        throw new Error("Bucket Object Lock returned an ambiguous empty response.");
      }
      objectLock = "absent";
    } else {
      const status = lock.ObjectLockConfiguration.ObjectLockEnabled as string | undefined;
      if (status === "Enabled") throw new Error("Bucket Object Lock is enabled.");
      if (status === "Disabled") {
        objectLock = "disabled";
      } else if (Object.keys(lock.ObjectLockConfiguration).length === 0 &&
        isRailwayManagedS3Endpoint(config.endpoint)) {
        // Railway documents Object Lock as unsupported and represents that
        // service-level absence as an empty successful response.
        objectLock = "absent";
      } else {
        throw new Error("Bucket Object Lock returned an ambiguous status.");
      }
    }
  } catch (error) {
    if (!isExplicitObjectLockAbsent(error)) throw error;
    objectLock = "absent";
  }

  const cors = await client.send(
    new GetBucketCorsCommand({ Bucket: config.bucket }),
    { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) }
  );
  if (!Array.isArray(cors.CORSRules) || cors.CORSRules.length === 0) {
    throw new Error("Bucket CORS returned no rules.");
  }
  const corsRules = verifyRailwayS3CorsContract(cors.CORSRules.map((rule) => ({
    allowed_origins: rule.AllowedOrigins ?? [],
    allowed_methods: rule.AllowedMethods ?? [],
    allowed_headers: rule.AllowedHeaders ?? [],
    exposed_headers: rule.ExposeHeaders ?? [],
    max_age_seconds: rule.MaxAgeSeconds ?? null
  })), expectedCorsOrigins);
  return { bucketVersioningNeverEnabled: true, objectLock, corsRules };
}

/**
 * Destructive only to one random `probe/` object created by this invocation.
 * Credentials, signed URLs, object keys, ETags, and payload bytes are never
 * returned. The returned attestation is non-secret and binds the exact target,
 * bucket controls, replay/deletion behavior, CORS policy, and expiry.
 */
export async function probeRailwayS3ReplayFence(
  config: RailwayS3ConnectionConfig,
  dependencies: Pick<RailwayS3StorageDependencies, "client" | "presign"> & {
    fetch?: typeof fetch;
    now?: () => Date;
    corsAllowedOrigins?: readonly string[];
    attestationLifetimeMs?: number;
  } = {}
): Promise<RailwayS3ReplayFenceProbeResult> {
  validateConnectionConfig(config);
  const client = dependencies.client ?? createS3Client(config);
  const presign = dependencies.presign ?? defaultPresigner;
  const fetchImpl = dependencies.fetch ?? fetch;
  const now = dependencies.now?.() ?? new Date();
  const attestationLifetimeMs = dependencies.attestationLifetimeMs ??
    RAILWAY_S3_SAFETY_ATTESTATION_MAX_AGE_MS;
  if (attestationLifetimeMs < 60_000 ||
    attestationLifetimeMs > RAILWAY_S3_SAFETY_ATTESTATION_MAX_AGE_MS) {
    throw new Error("The S3 safety attestation lifetime is outside the permitted range.");
  }
  const expectedCorsOrigins = canonicalRailwayS3CorsOrigins(dependencies.corsAllowedOrigins ?? []);
  if (expectedCorsOrigins.length === 0) {
    throw new Error("The S3 safety probe requires at least one expected CORS origin.");
  }
  const key = `probe/replay-fence/${crypto.randomUUID()}`;
  const body = new TextEncoder().encode(`rfp-xray-replay-fence:${crypto.randomUUID()}`);
  let deleted = false;

  const controlPlane = await probeRailwayS3ControlPlane(config, {
    client,
    corsAllowedOrigins: expectedCorsOrigins
  });

  const head = async () => {
    try {
      return await client.send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) }
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  };
  const conditionalDelete = async () => {
    const current = await head();
    if (!current) {
      deleted = true;
      return;
    }
    await client.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
      IfMatch: requireEtag(current.ETag),
      ...(current.VersionId ? { VersionId: current.VersionId } : {})
    }), { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) });
    deleted = (await head()) === null;
  };
  const verifyNoRetainedVersions = async (): Promise<"verified_empty" | "listing_unsupported"> => {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      let listed;
      try {
        listed = await client.send(new ListObjectVersionsCommand({
          Bucket: config.bucket,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
          MaxKeys: 100
        }), { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) });
      } catch (error) {
        if (isExplicitVersionListingUnsupported(error)) return "listing_unsupported";
        throw error;
      }
      const retained = [
        ...(listed.Versions ?? []).map((item) => item.Key),
        ...(listed.DeleteMarkers ?? []).map((item) => item.Key)
      ].filter((candidate) => candidate === key);
      if (retained.length > 0) {
        throw new Error("The probe object still has a retained version or delete marker.");
      }
      if (!listed.IsTruncated) return "verified_empty";
      if (!listed.NextKeyMarker ||
        (listed.NextKeyMarker === keyMarker && listed.NextVersionIdMarker === versionIdMarker)) {
        throw new Error("Version listing pagination was ambiguous.");
      }
      keyMarker = listed.NextKeyMarker;
      versionIdMarker = listed.NextVersionIdMarker;
    }
    throw new Error("Version listing exceeded the bounded safety-probe pagination limit.");
  };
  const putViaSignedUrl = async (url: string) => {
    const response = await fetchImpl(url, {
      method: "PUT",
      headers: {
        "content-type": "application/pdf",
        "content-length": String(body.byteLength),
        "if-none-match": "*"
      },
      body
    });
    await response.body?.cancel();
    return response.status;
  };

  try {
    const signedUrl = await presign(client, new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: "application/pdf",
      ContentLength: body.byteLength,
      IfNoneMatch: "*"
    }), {
      expiresIn: MAX_SIGNED_URL_SECONDS,
      signableHeaders: new Set(["content-length", "content-type", "if-none-match"])
    });
    if (new URL(signedUrl).protocol !== "https:") throw new Error("Replay probe received a non-HTTPS URL.");

    const initialStatus = await putViaSignedUrl(signedUrl);
    if (initialStatus < 200 || initialStatus >= 300) throw new Error("Replay probe initial upload was rejected.");
    const initial = await head();
    if (!initial || initial.ContentLength !== body.byteLength) {
      throw new Error("Replay probe could not confirm the exact uploaded size.");
    }

    const replayStatus = await putViaSignedUrl(signedUrl);
    if (replayStatus !== 409 && replayStatus !== 412) {
      throw new Error("Replay probe provider did not reject a repeated signed PUT.");
    }

    const fenced = await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: new Uint8Array(),
      ContentType: "application/octet-stream",
      ContentLength: 0,
      IfMatch: requireEtag(initial.ETag)
    }), { abortSignal: AbortSignal.timeout(S3_COMMAND_TIMEOUT_MS) });
    const fenceHead = await head();
    if (!fenceHead || fenceHead.ContentLength !== 0 ||
      requireEtag(fenceHead.ETag) !== requireEtag(fenced.ETag)) {
      throw new Error("Replay probe could not confirm the zero-byte compare-and-swap fence.");
    }

    const replayAfterFenceStatus = await putViaSignedUrl(signedUrl);
    if (replayAfterFenceStatus !== 409 && replayAfterFenceStatus !== 412) {
      throw new Error("Replay probe signed PUT replaced the zero-byte fence.");
    }

    await conditionalDelete();
    if (!deleted) throw new Error("Replay probe deletion could not be confirmed.");
    const objectVersions = await verifyNoRetainedVersions();
    const safetyAttestationExpiresAt = new Date(now.getTime() + attestationLifetimeMs).toISOString();
    const safetyAttestation = createRailwayS3SafetyAttestation({
      target: config,
      issuedAt: now,
      expiresAt: new Date(safetyAttestationExpiresAt),
      objectLock: controlPlane.objectLock,
      objectVersions,
      corsExpectedOrigins: expectedCorsOrigins,
      corsRules: controlPlane.corsRules
    });
    return {
      initialUploadAccepted: true,
      replayRejected: true,
      exactSizeStored: true,
      casFenceWritten: true,
      replayAfterFenceRejected: true,
      deleteConfirmed: true,
      bucketVersioningNeverEnabled: true,
      objectLockAbsentOrDisabled: true,
      objectVersions,
      corsContractVerified: true,
      safetyAttestation,
      safetyAttestationExpiresAt
    };
  } finally {
    if (!deleted) {
      try {
        await conditionalDelete();
      } catch {
        // The caller receives the original failure. The unique probe key is
        // retained only when safe conditional cleanup itself could not run.
      }
    }
  }
}
