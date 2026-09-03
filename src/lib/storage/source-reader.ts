import type { CreateRunRequest } from "@/contracts";
import { sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { assertPdfBytes, normalizeFilename, validateCanadaBuysUrl } from "@/lib/source-validation";
import type { CleanupTarget } from "@/lib/cleanup";
import type { UploadStorage } from "@/lib/storage/uploads";

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

export async function loadSource(
  document: RunDocumentInput,
  dependencies: SourceReaderDependencies
): Promise<LoadedSource> {
  const documentId = crypto.randomUUID();
  if (document.source.type === "url") {
    const fetched = await fetchCanadaBuysPdf(document.source.url, dependencies.fetcher ?? fetch);
    const bytes = fetched.bytes;
    const stagedId = `staged:${documentId}`;
    return {
      documentId,
      role: document.role,
      sourceType: "url",
      sourceName: filenameFromUrl(new URL(fetched.url)),
      sourceUrl: fetched.url,
      blobPath: null,
      bytes,
      sha256: sha256Hex(bytes),
      parserUrl: async () => fetched.url,
      cleanupTargets: [
        {
          resourceId: stagedId,
          resourceKind: "staged_source",
          controlScope: "application",
          remove: async () => {
            bytes.fill(0);
          }
        }
      ]
    };
  }

  const bytes = await dependencies.uploadStorage.read(document.source.blob_path);
  assertPdfBytes(bytes, document.source.size_bytes);
  const digest = sha256Hex(bytes);
  if (digest !== document.source.sha256) {
    bytes.fill(0);
    throw new AppError("UNSUPPORTED_MEDIA", "The uploaded PDF SHA-256 does not match its declaration.", {
      httpStatus: 422
    });
  }
  const blobPath = document.source.blob_path;
  return {
    documentId,
    role: document.role,
    sourceType: "upload",
    sourceName: normalizeFilename(document.source.filename),
    sourceUrl: null,
    blobPath,
    bytes,
    sha256: digest,
    parserUrl: (validUntil) => dependencies.uploadStorage.temporaryReadUrl(blobPath, validUntil),
    cleanupTargets: [
      {
        resourceId: `blob:${blobPath}`,
        resourceKind: "source_blob",
        controlScope: "application",
        remove: () => dependencies.uploadStorage.remove(blobPath)
      },
      {
        resourceId: `staged:${documentId}`,
        resourceKind: "staged_source",
        controlScope: "application",
        remove: async () => {
          bytes.fill(0);
        }
      }
    ]
  };
}
