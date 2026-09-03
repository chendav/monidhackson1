import { del, get, issueSignedToken, presignUrl } from "@vercel/blob";
import type { PresignUploadRequest, PresignUploadResponse } from "@/contracts";
import { getConfig, type AppConfig } from "@/lib/config";
import { sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { normalizeFilename, ownerUploadNamespace } from "@/lib/source-validation";

interface PresignContext {
  ownerId: string;
  origin: string;
}

export interface UploadStorage {
  presign(input: PresignUploadRequest, context: PresignContext): Promise<PresignUploadResponse>;
  read(blobPath: string): Promise<Uint8Array>;
  temporaryReadUrl(blobPath: string, validUntil: Date): Promise<string>;
  remove(blobPath: string): Promise<void>;
}

interface LocalGrant {
  blobPath: string;
  expectedSha256: string;
  expectedSize: number;
  expiresAt: number;
  used: boolean;
}

export class LocalUploadStorage implements UploadStorage {
  private readonly grants = new Map<string, LocalGrant>();
  private readonly objects = new Map<string, Uint8Array>();

  constructor(private readonly namespaceSecret = "rfp-xray-local-session-secret-do-not-use-in-production") {}

  async presign(input: PresignUploadRequest, context: PresignContext): Promise<PresignUploadResponse> {
    normalizeFilename(input.filename);
    const token = crypto.randomUUID();
    const blobPath = `incoming/${ownerUploadNamespace(context.ownerId, this.namespaceSecret)}/${crypto.randomUUID()}/${input.sha256}.pdf`;
    const expiresAt = Date.now() + 5 * 60_000;
    this.grants.set(token, {
      blobPath,
      expectedSha256: input.sha256,
      expectedSize: input.size_bytes,
      expiresAt,
      used: false
    });
    return {
      blob_path: blobPath,
      upload_url: new URL(`/api/v1/uploads/local/${token}`, context.origin).toString(),
      expires_at: new Date(expiresAt).toISOString(),
      method: "PUT",
      headers: { "content-type": "application/pdf" }
    };
  }

  async acceptPut(token: string, request: Request): Promise<void> {
    const grant = this.grants.get(token);
    if (!grant || grant.expiresAt <= Date.now() || grant.used) {
      throw new AppError("UNSAFE_URL", "The upload grant is invalid or expired.", { httpStatus: 410 });
    }
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength !== grant.expectedSize) {
      throw new AppError("UNSUPPORTED_MEDIA", "The upload size does not match the signed request.", {
        httpStatus: 422
      });
    }
    if (!request.body) {
      throw new AppError("UNSUPPORTED_MEDIA", "The PDF upload body is empty.", { httpStatus: 422 });
    }
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > grant.expectedSize) {
          throw new AppError("FILE_TOO_LARGE", "The upload exceeds its signed size.", {
            httpStatus: 413
          });
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
    if (bytes.byteLength !== grant.expectedSize) {
      throw new AppError("UNSUPPORTED_MEDIA", "The upload size does not match the signed request.", {
        httpStatus: 422
      });
    }
    if (sha256Hex(bytes) !== grant.expectedSha256) {
      throw new AppError("UNSUPPORTED_MEDIA", "The upload SHA-256 does not match the signed request.", {
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
    grant.used = true;
  }

  async read(blobPath: string): Promise<Uint8Array> {
    const bytes = this.objects.get(blobPath);
    if (!bytes) {
      throw new AppError("SOURCE_UNREACHABLE", "The uploaded PDF was not found.", {
        httpStatus: 404,
        retryable: false
      });
    }
    return bytes.slice();
  }

  async temporaryReadUrl(): Promise<string> {
    throw new AppError(
      "MONID_PARSE_FAILED",
      "Local uploads cannot be exposed to the live parsing provider. Configure Private Blob.",
      { httpStatus: 503 }
    );
  }

  async remove(blobPath: string): Promise<void> {
    this.objects.delete(blobPath);
    if (this.objects.has(blobPath)) throw new Error("Local object remained after deletion.");
  }

  clear() {
    this.grants.clear();
    this.objects.clear();
  }
}

export class VercelBlobUploadStorage implements UploadStorage {
  constructor(private readonly config: AppConfig = getConfig()) {}

  private get token(): string | undefined {
    return this.config.BLOB_READ_WRITE_TOKEN;
  }

  private namespaceSecret() {
    return this.config.SESSION_SIGNING_SECRET ?? this.config.IP_HASH_SECRET ?? "";
  }

  async presign(input: PresignUploadRequest, context: PresignContext): Promise<PresignUploadResponse> {
    normalizeFilename(input.filename);
    const expiresAt = Date.now() + 5 * 60_000;
    const blobPath = `incoming/${ownerUploadNamespace(context.ownerId, this.namespaceSecret())}/${crypto.randomUUID()}/${input.sha256}.pdf`;
    const signed = await issueSignedToken({
      token: this.token,
      pathname: blobPath,
      operations: ["put"],
      validUntil: expiresAt,
      allowedContentTypes: ["application/pdf"],
      maximumSizeInBytes: input.size_bytes
    });
    const { presignedUrl } = await presignUrl(signed, {
      access: "private",
      operation: "put",
      pathname: blobPath,
      validUntil: expiresAt,
      allowedContentTypes: ["application/pdf"],
      maximumSizeInBytes: input.size_bytes,
      allowOverwrite: false,
      addRandomSuffix: false,
      cacheControlMaxAge: 60
    });
    return {
      blob_path: blobPath,
      upload_url: presignedUrl,
      expires_at: new Date(expiresAt).toISOString(),
      method: "PUT",
      headers: { "content-type": "application/pdf" }
    };
  }

  async read(blobPath: string): Promise<Uint8Array> {
    const result = await get(blobPath, {
      access: "private",
      token: this.token,
      useCache: false,
      abortSignal: AbortSignal.timeout(15_000)
    });
    if (!result || result.statusCode === 304 || !result.stream) {
      throw new AppError("SOURCE_UNREACHABLE", "The uploaded PDF was not found.", {
        httpStatus: 404
      });
    }
    if ((result.blob.size ?? 0) > 25 * 1024 * 1024) {
      await result.stream.cancel();
      throw new AppError("FILE_TOO_LARGE", "The uploaded PDF exceeds 25 MB.", {
        httpStatus: 413
      });
    }
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    if (bytes.byteLength > 25 * 1024 * 1024) {
      throw new AppError("FILE_TOO_LARGE", "The uploaded PDF exceeds 25 MB.", {
        httpStatus: 413
      });
    }
    return bytes;
  }

  async temporaryReadUrl(blobPath: string, validUntil: Date): Promise<string> {
    const signed = await issueSignedToken({
      token: this.token,
      pathname: blobPath,
      operations: ["get"],
      validUntil: validUntil.getTime()
    });
    const { presignedUrl } = await presignUrl(signed, {
      access: "private",
      operation: "get",
      pathname: blobPath,
      validUntil: validUntil.getTime(),
      useCache: false
    });
    return presignedUrl;
  }

  async remove(blobPath: string): Promise<void> {
    await del(blobPath, { token: this.token });
    const remaining = await get(blobPath, {
      access: "private",
      token: this.token,
      useCache: false,
      abortSignal: AbortSignal.timeout(10_000)
    });
    if (remaining) {
      await remaining.stream?.cancel();
      throw new Error("Blob deletion could not be confirmed.");
    }
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
  localStorage ??= new LocalUploadStorage(
    config.SESSION_SIGNING_SECRET ?? "rfp-xray-local-session-secret-do-not-use-in-production"
  );
  return localStorage;
}

export function getLocalUploadStorage(): LocalUploadStorage {
  const storage = getUploadStorage();
  if (!(storage instanceof LocalUploadStorage)) {
    throw new AppError("UNSUPPORTED_MEDIA", "The local upload endpoint is disabled.", {
      httpStatus: 404
    });
  }
  return storage;
}

export function resetUploadStorageForTests() {
  localStorage?.clear();
  localStorage = undefined;
  storageOverride = undefined;
}
