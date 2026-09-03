import {
  CreateRunRequestSchema,
  type CreateRunRequest
} from "@/contracts";
import { hmacSha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";

export const MAX_DOCUMENTS = 5;
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_PACKAGE_PAGES = 300;
export const ALLOWED_URL_HOST = "canadabuys.canada.ca";
type RunDocumentInput = CreateRunRequest["documents"][number];

export function validateCanadaBuysUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (cause) {
    throw new AppError("UNSAFE_URL", "The source URL is not valid.", { cause });
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== ALLOWED_URL_HOST ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new AppError(
      "UNSAFE_URL",
      `Only HTTPS URLs on ${ALLOWED_URL_HOST} are accepted.`
    );
  }

  url.hash = "";
  url.hostname = ALLOWED_URL_HOST;
  return url;
}

export function normalizeFilename(filename: string): string {
  const normalized = filename.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (
    normalized.length === 0 ||
    normalized.length > 200 ||
    !normalized.toLowerCase().endsWith(".pdf") ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized === ".pdf"
  ) {
    throw new AppError("UNSUPPORTED_MEDIA", "A safe PDF filename is required.");
  }
  return normalized;
}

export function ownerUploadNamespace(ownerId: string, secret: string): string {
  return hmacSha256Hex(secret, `upload:${ownerId}`).slice(0, 24);
}

export function assertOwnedBlobPath(blobPath: string, ownerId: string, secret: string) {
  const expectedPrefix = `incoming/${ownerUploadNamespace(ownerId, secret)}/`;
  if (!blobPath.startsWith(expectedPrefix) || blobPath.includes("..") || blobPath.length > 512) {
    throw new AppError("UNSAFE_URL", "The upload reference is invalid for this session.", {
      httpStatus: 403
    });
  }
}

export function validateCreateRunRequest(
  value: unknown,
  options?: { ownerId?: string; uploadSecret?: string }
): CreateRunRequest {
  const parsed = CreateRunRequestSchema.safeParse(value);
  if (!parsed.success) {
    const fileTooLarge = parsed.error.issues.some(
      (issue) => issue.path.at(-1) === "size_bytes" && issue.code === "too_big"
    );
    throw new AppError(
      fileTooLarge ? "FILE_TOO_LARGE" : "UNSUPPORTED_MEDIA",
      parsed.error.issues.map((issue) => issue.message).join(" "),
      { httpStatus: 422 }
    );
  }

  const documents = parsed.data.documents.map((document) =>
    normalizeDocument(document, options)
  );

  return { documents };
}

function normalizeDocument(
  document: RunDocumentInput,
  options?: { ownerId?: string; uploadSecret?: string }
): RunDocumentInput {
  if (document.source.type === "url") {
    return {
      ...document,
      source: { type: "url", url: validateCanadaBuysUrl(document.source.url).toString() }
    };
  }

  if (document.source.size_bytes > MAX_DOCUMENT_BYTES) {
    throw new AppError("FILE_TOO_LARGE", "Each PDF must be 25 MB or smaller.", {
      httpStatus: 413
    });
  }

  if (options?.ownerId && options.uploadSecret) {
    assertOwnedBlobPath(document.source.blob_path, options.ownerId, options.uploadSecret);
  }

  return {
    ...document,
    source: {
      ...document.source,
      filename: normalizeFilename(document.source.filename)
    }
  };
}

export function assertAggregatePages(pageCounts: number[]) {
  const total = pageCounts.reduce((sum, count) => sum + count, 0);
  if (total > MAX_PACKAGE_PAGES) {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      `The package contains ${total} pages; the maximum is ${MAX_PACKAGE_PAGES}.`,
      { httpStatus: 422 }
    );
  }
}

export function assertPdfBytes(bytes: Uint8Array, declaredSize?: number) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new AppError("FILE_TOO_LARGE", "Each PDF must be between 1 byte and 25 MB.", {
      httpStatus: 413
    });
  }
  if (declaredSize !== undefined && bytes.byteLength !== declaredSize) {
    throw new AppError("UNSUPPORTED_MEDIA", "The uploaded PDF size does not match its declaration.");
  }
  const signature = new TextDecoder("ascii").decode(bytes.subarray(0, 5));
  if (signature !== "%PDF-") {
    throw new AppError("UNSUPPORTED_MEDIA", "The source is not a PDF file.", {
      httpStatus: 415
    });
  }
}
