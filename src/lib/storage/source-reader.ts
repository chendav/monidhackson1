import type { CreateRunRequest } from "@/contracts";
import { sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { assertPdfBytes, normalizeFilename, validateCanadaBuysUrl } from "@/lib/source-validation";
import type { CleanupTarget } from "@/lib/cleanup";
import { stagingBlobPath, type UploadStorage } from "@/lib/storage/uploads";

type RunDocumentInput = CreateRunRequest["documents"][number];

export interface LoadedSource {
  documentId: string;
  role: RunDocumentInput["role"];
  sourceType: "url" | "upload";
  sourceName: string;
  sourceUrl: string | null;
  blobPath: string | null;
  bytes: Uint8Array;
  sha256: string;
  parserUrl(validUntil: Date): Promise<string>;
  cleanupTargets: CleanupTarget[];
}

export interface SourceReaderDependencies {
  uploadStorage: UploadStorage;
  fetcher?: typeof fetch;
  runId: string;
  ownerId: string;
  documentIndex: number;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new AppError("FILE_TOO_LARGE", "Each PDF must be 25 MB or smaller.", {
      httpStatus: 413
    });
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new AppError("FILE_TOO_LARGE", "Each PDF must be 25 MB or smaller.", {
          httpStatus: 413
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function fetchCanadaBuysPdf(rawUrl: string, fetcher: typeof fetch): Promise<{ bytes: Uint8Array; url: string }> {
  let current = validateCanadaBuysUrl(rawUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetcher(current, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { accept: "application/pdf,application/octet-stream;q=0.8" },
      signal: AbortSignal.timeout(20_000)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) {
        throw new AppError("SOURCE_UNREACHABLE", "The CanadaBuys PDF redirect could not be followed.", {
          httpStatus: 502,
          retryable: true
        });
      }
      current = validateCanadaBuysUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) {
      throw new AppError("SOURCE_UNREACHABLE", "The CanadaBuys PDF could not be downloaded.", {
        httpStatus: 502,
        retryable: response.status >= 500 || response.status === 429
      });
    }
    const bytes = await readBoundedBody(response, 25 * 1024 * 1024);
    assertPdfBytes(bytes);
    return { bytes, url: current.toString() };
  }
  throw new AppError("SOURCE_UNREACHABLE", "The CanadaBuys PDF could not be downloaded.");
}

function filenameFromUrl(url: URL): string {
  const segment = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "source.pdf");
  try {
    return normalizeFilename(segment.toLowerCase().endsWith(".pdf") ? segment : `${segment || "source"}.pdf`);
  } catch {
    return "canadabuys-source.pdf";
  }
}

async function readExistingStage(storage: UploadStorage, blobPath: string): Promise<Uint8Array | null> {
  try {
    return await storage.read(blobPath);
  } catch (error) {
    if (error instanceof AppError && error.code === "SOURCE_UNREACHABLE" && error.httpStatus === 404) {
      return null;
    }
    throw error;
  }
}

function stagedCleanupTarget(
  storage: UploadStorage,
  stagedPath: string,
  stageResourceId: string,
  bytes: Uint8Array
): CleanupTarget {
  return {
    resourceId: stageResourceId,
    resourceKind: "staged_source",
    controlScope: "application",
    remove: async () => {
      bytes.fill(0);
      await storage.remove(stagedPath);
    }
  };
}

export async function loadSource(
  document: RunDocumentInput,
  dependencies: SourceReaderDependencies
): Promise<LoadedSource> {
  const documentId = crypto.randomUUID();
  const stageResourceId = `staged:${dependencies.runId}:${dependencies.documentIndex}`;
  const stagedPath = stagingBlobPath(dependencies.runId, dependencies.documentIndex);
  if (document.source.type === "url") {
    const existing = await readExistingStage(dependencies.uploadStorage, stagedPath);
    const fetched = existing
      ? { bytes: existing, url: validateCanadaBuysUrl(document.source.url).toString() }
      : await fetchCanadaBuysPdf(document.source.url, dependencies.fetcher ?? fetch);
    const bytes = fetched.bytes;
    assertPdfBytes(bytes);
    const digest = sha256Hex(bytes);
    if (!existing) await dependencies.uploadStorage.stage(stagedPath, bytes);
    return {
      documentId,
      role: document.role,
      sourceType: "url",
      sourceName: filenameFromUrl(new URL(fetched.url)),
      sourceUrl: fetched.url,
      blobPath: null,
      bytes,
      sha256: digest,
      parserUrl: (validUntil) => dependencies.uploadStorage.temporaryReadUrl(stagedPath, validUntil),
      cleanupTargets: [stagedCleanupTarget(
        dependencies.uploadStorage,
        stagedPath,
        stageResourceId,
        bytes
      )]
    };
  }

  await dependencies.uploadStorage.claimIncoming({
    ownerId: dependencies.ownerId,
    runId: dependencies.runId,
    blobPath: document.source.blob_path,
    expectedSha256: document.source.sha256,
    expectedSize: document.source.size_bytes
  });
  const existing = await readExistingStage(dependencies.uploadStorage, stagedPath);
  const bytes = existing ?? await dependencies.uploadStorage.read(document.source.blob_path);
  assertPdfBytes(bytes, document.source.size_bytes);
  const digest = sha256Hex(bytes);
  if (digest !== document.source.sha256) {
    bytes.fill(0);
    throw new AppError("UNSUPPORTED_MEDIA", "The uploaded PDF SHA-256 does not match its declaration.", {
      httpStatus: 422
    });
  }
  const blobPath = document.source.blob_path;
  if (!existing) await dependencies.uploadStorage.stage(stagedPath, bytes, blobPath);
  // Staging has been read back and verified by the storage adapter. Replace the
  // replayable incoming URL's raw bytes immediately; Monid reads only staging.
  try {
    await dependencies.uploadStorage.purgeIncomingToFence(blobPath, dependencies.runId);
  } catch (error) {
    throw new AppError(
      "SOURCE_CLEANUP_PENDING",
      "The incoming upload could not be replaced by its replay fence.",
      { retryable: true, cause: error }
    );
  }
  return {
    documentId,
    role: document.role,
    sourceType: "upload",
    sourceName: normalizeFilename(document.source.filename),
    sourceUrl: null,
    blobPath,
    bytes,
    sha256: digest,
    parserUrl: (validUntil) => dependencies.uploadStorage.temporaryReadUrl(stagedPath, validUntil),
    cleanupTargets: [
      {
        resourceId: `blob:${blobPath}`,
        resourceKind: "source_blob",
        controlScope: "application",
        successDetail: "Incoming source content was purged and a verified replay-blocking fence remains until grant expiry.",
        remove: () => dependencies.uploadStorage.purgeIncomingToFence(blobPath, dependencies.runId)
      },
      stagedCleanupTarget(dependencies.uploadStorage, stagedPath, stageResourceId, bytes)
    ]
  };
}
