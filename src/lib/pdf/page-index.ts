import { sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { assertPdfBytes, MAX_PACKAGE_PAGES } from "@/lib/source-validation";

export const PAGE_INDEX_VERSION = "pdfjs-1based-v1";

export interface IndexedPage {
  pdfPage1Based: number;
  printedPageLabel: string | null;
  text: string;
  normalizedText: string;
  representationSha256: string;
}

export interface EvidenceChunk {
  chunkId: string;
  documentSha256: string;
  text: string;
}

export interface PdfPageIndex {
  documentSha256: string;
  representationSha256: string;
  pagesTotal: number;
  pages: IndexedPage[];
  chunks: EvidenceChunk[];
  embeddedJavaScriptDetected: boolean;
  indexVersion: typeof PAGE_INDEX_VERSION;
}

export function normalizeEvidenceText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u00ad\u200b-\u200d\ufeff]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-CA");
}

function buildChunks(documentSha256: string, pages: IndexedPage[]): EvidenceChunk[] {
  const chunks: EvidenceChunk[] = [];
  let ordinal = 0;
  for (const page of pages) {
    const paragraphs = page.text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    for (const paragraph of paragraphs.length > 0 ? paragraphs : [page.text]) {
      for (let offset = 0; offset < paragraph.length; offset += 2_800) {
        const text = paragraph.slice(offset, offset + 3_000).trim();
        if (!text) continue;
        const chunkId = sha256Hex(`${documentSha256}\u0000${ordinal}\u0000${text}`).slice(0, 24);
        chunks.push({ chunkId, documentSha256, text });
        ordinal += 1;
      }
    }
  }
  return chunks;
}

export async function buildPdfPageIndex(
  input: Uint8Array,
  options: { maxPages?: number; declaredSize?: number } = {}
): Promise<PdfPageIndex> {
  assertPdfBytes(input, options.declaredSize);
  const maxPages = options.maxPages ?? MAX_PACKAGE_PAGES;
  const documentSha256 = sha256Hex(input);
  let loadingTask: { destroy(): Promise<void> } | undefined;

  try {
    // PDF.js uses a fake worker under Node. Importing the worker explicitly makes
    // Turbopack trace and bundle it, while the worker module installs the
    // `globalThis.pdfjsWorker` handler that PDF.js looks for server-side.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({
      data: input.slice(),
      useSystemFonts: true,
      disableAutoFetch: true,
      disableStream: true,
      stopAtErrors: true
    });
    loadingTask = task;
    const document = await task.promise;
    if (document.numPages > maxPages) {
      throw new AppError(
        "ANALYSIS_INCOMPLETE",
        `The PDF has ${document.numPages} pages; the remaining package allowance is ${maxPages}.`,
        { httpStatus: 422 }
      );
    }

    const labels = await document.getPageLabels();
    const jsActions = await document.getJSActions();
    const pages: IndexedPage[] = [];
    for (let pdfPage1Based = 1; pdfPage1Based <= document.numPages; pdfPage1Based += 1) {
      const page = await document.getPage(pdfPage1Based);
      const content = await page.getTextContent({ includeMarkedContent: false });
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
      }
      text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      const normalizedText = normalizeEvidenceText(text);
      pages.push({
        pdfPage1Based,
        printedPageLabel: labels?.[pdfPage1Based - 1] ?? null,
        text,
        normalizedText,
        representationSha256: sha256Hex(normalizedText)
      });
      page.cleanup();
    }

    const representationSha256 = sha256Hex(
      pages.map((page) => `${page.pdfPage1Based}\u0000${page.normalizedText}`).join("\u0001")
    );
    return {
      documentSha256,
      representationSha256,
      pagesTotal: pages.length,
      pages,
      chunks: buildChunks(documentSha256, pages),
      embeddedJavaScriptDetected: Boolean(jsActions && jsActions.size > 0),
      indexVersion: PAGE_INDEX_VERSION
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") {
      throw new AppError("ENCRYPTED_PDF", "Encrypted PDFs are not supported.", {
        httpStatus: 422,
        cause: error
      });
    }
    throw new AppError("UNSUPPORTED_MEDIA", "The PDF could not be indexed safely.", {
      httpStatus: 422,
      cause: error
    });
  } finally {
    await loadingTask?.destroy().catch(() => undefined);
  }
}
