import type { Citation } from "@/contracts";
import { sha256Hex } from "@/lib/crypto";
import {
  normalizeEvidenceText,
  PAGE_INDEX_VERSION,
  type PdfPageIndex
} from "@/lib/pdf/page-index";

export interface CitationCandidate {
  documentSha256: string;
  evidenceQuote: string;
  chunkId?: string | null;
  section?: string | null;
}

export interface CitationDocument {
  name: string;
  sourceUrl: string | null;
  index: PdfPageIndex;
}

export interface QuoteVerificationReceipt {
  receiptId: string;
  documentSha256: string;
  representationSha256: string;
  fragmentSha256: string;
  pdfPage1Based: number | null;
  method: "exact" | "normalized" | "manual_required";
  verifierVersion: typeof PAGE_INDEX_VERSION;
  verified: boolean;
  createdAt: string;
}

export interface CitationVerification {
  citation: Citation;
  receipt: QuoteVerificationReceipt;
}

const MONTH_NUMBER = new Map([
  ["january", 1], ["jan", 1], ["february", 2], ["feb", 2],
  ["march", 3], ["mar", 3], ["april", 4], ["apr", 4],
  ["may", 5], ["june", 6], ["jun", 6], ["july", 7], ["jul", 7],
  ["august", 8], ["aug", 8], ["september", 9], ["sept", 9], ["sep", 9],
  ["october", 10], ["oct", 10], ["november", 11], ["nov", 11],
  ["december", 12], ["dec", 12]
]);

function canonicalNumber(value: string) {
  const number = Number(value.replace(/[\s,]/g, ""));
  return Number.isFinite(number) ? number.toString() : value;
}

function blankRange(value: string, start: number, end: number) {
  return `${value.slice(0, start)}${" ".repeat(end - start)}${value.slice(end)}`;
}

/**
 * Extracts only objectively comparable scalar tokens. Dates and times are
 * canonicalized before ordinary numbers so equivalent renderings such as
 * `2026-09-15` / `September 15, 2026` and `14:00` / `2:00 PM` compare cleanly.
 */
export function extractAssertionTokens(value: string): Set<string> {
  let remainder = value.normalize("NFKC").toLocaleLowerCase("en-CA");
  const tokens = new Set<string>();
  const ranges: Array<{ start: number; end: number }> = [];

  const recordDate = (start: number, end: number, year: number, month: number, day: number) => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return;
    tokens.add(`date:${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`);
    ranges.push({ start, end });
  };

  for (const match of remainder.matchAll(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g)) {
    recordDate(match.index, match.index + match[0].length, Number(match[1]), Number(match[2]), Number(match[3]));
  }
  const monthPattern = "january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec";
  for (const match of remainder.matchAll(new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{4})\\b`, "g"))) {
    recordDate(match.index, match.index + match[0].length, Number(match[3]), MONTH_NUMBER.get(match[1]) ?? 0, Number(match[2]));
  }
  for (const match of remainder.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\.?[,]?\\s+(\\d{4})\\b`, "g"))) {
    recordDate(match.index, match.index + match[0].length, Number(match[3]), MONTH_NUMBER.get(match[2]) ?? 0, Number(match[1]));
  }

  for (const { start, end } of ranges.toSorted((left, right) => right.start - left.start)) {
    remainder = blankRange(remainder, start, end);
  }

  const timeRanges: Array<{ start: number; end: number }> = [];
  for (const match of remainder.matchAll(/(?<![+\-\d:])(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?(?![\d:])/g)) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridiem = match[3]?.replaceAll(".", "");
    if (hour > 23 || minute > 59) continue;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    tokens.add(`time:${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`);
    timeRanges.push({ start: match.index, end: match.index + match[0].length });
  }
  for (const { start, end } of timeRanges.toSorted((left, right) => right.start - left.start)) {
    remainder = blankRange(remainder, start, end);
  }

  // UTC offsets are metadata for an already captured time, not an additional
  // asserted quantity that a human-readable "MDT" quote needs to spell out.
  remainder = remainder.replace(/[+\-]\d{2}:\d{2}\b/g, (offset) => " ".repeat(offset.length));

  for (const match of remainder.matchAll(/(?<![\p{L}\p{N}])(?:\d{1,3}(?:[ ,]\d{3})+|\d+)(?:\.\d+)?(?![\p{L}\p{N}])/gu)) {
    tokens.add(`number:${canonicalNumber(match[0])}`);
  }
  return tokens;
}

export function citationsMatchDocument(
  citations: Citation[],
  documentSha256: string
): boolean {
  const expected = documentSha256.toLowerCase();
  return citations.length > 0 && citations.every(
    (citation) => citation.verified && citation.document_sha256 === expected
  );
}

export function assertionTokensSupportedByCitations(
  assertion: string,
  citations: Citation[]
): boolean {
  const asserted = extractAssertionTokens(assertion);
  if (asserted.size === 0) return true;
  const evidence = new Set(
    citations.flatMap((citation) => [...extractAssertionTokens(citation.evidence_quote)])
  );
  return [...asserted].every((token) => evidence.has(token));
}

function findPage(
  candidate: CitationCandidate,
  index: PdfPageIndex
): { page: PdfPageIndex["pages"][number] | undefined; method: "exact" | "normalized" | "manual_required" } {
  const quote = candidate.evidenceQuote.trim();
  if (!quote) return { page: undefined, method: "manual_required" };

  let candidatePages = index.pages;
  if (candidate.chunkId) {
    const chunk = index.chunks.find((item) => item.chunkId === candidate.chunkId);
    if (!chunk || chunk.documentSha256 !== candidate.documentSha256) {
      return { page: undefined, method: "manual_required" };
    }
    const matchingPages = index.pages.filter((page) => page.text.includes(chunk.text));
    if (matchingPages.length === 1) candidatePages = matchingPages;
  }

  const exact = candidatePages.filter((page) => page.text.includes(quote));
  if (exact.length === 1) return { page: exact[0], method: "exact" };

  const normalizedQuote = normalizeEvidenceText(quote);
  if (normalizedQuote.length < 8) return { page: undefined, method: "manual_required" };
  const normalized = candidatePages.filter((page) => page.normalizedText.includes(normalizedQuote));
  if (normalized.length === 1) return { page: normalized[0], method: "normalized" };
  return { page: undefined, method: "manual_required" };
}

export function verifyCitation(
  candidate: CitationCandidate,
  documents: CitationDocument[],
  now = new Date()
): CitationVerification {
  const document = documents.find(
    (item) => item.index.documentSha256 === candidate.documentSha256.toLowerCase()
  );
  const boundedQuote = candidate.evidenceQuote.trim().slice(0, 500);
  const located = document
    ? findPage({ ...candidate, evidenceQuote: boundedQuote }, document.index)
    : { page: undefined, method: "manual_required" as const };
  const verified = Boolean(document && located.page && located.method !== "manual_required");
  const citation: Citation = {
    document_sha256: candidate.documentSha256.toLowerCase(),
    document_name: document?.name ?? "Unknown document",
    source_url: document?.sourceUrl ?? null,
    pdf_page_1based: located.page?.pdfPage1Based ?? null,
    printed_page_label: located.page?.printedPageLabel ?? null,
    section: candidate.section?.trim() || null,
    evidence_quote: boundedQuote || "No verifiable quote supplied.",
    verified,
    verification_method: located.method
  };
  const receipt: QuoteVerificationReceipt = {
    receiptId: crypto.randomUUID(),
    documentSha256: candidate.documentSha256.toLowerCase(),
    representationSha256: document?.index.representationSha256 ?? sha256Hex("missing-document"),
    fragmentSha256: sha256Hex(normalizeEvidenceText(boundedQuote)),
    pdfPage1Based: located.page?.pdfPage1Based ?? null,
    method: located.method,
    verifierVersion: PAGE_INDEX_VERSION,
    verified,
    createdAt: now.toISOString()
  };
  return { citation, receipt };
}

export function verifyCitationBatch(
  candidates: CitationCandidate[],
  documents: CitationDocument[],
  now = new Date()
): { citations: Citation[]; receipts: QuoteVerificationReceipt[] } {
  const verifications = candidates.map((candidate) => verifyCitation(candidate, documents, now));
  return {
    citations: verifications.map((item) => item.citation),
    receipts: verifications.map((item) => item.receipt)
  };
}

export function allCitationsVerified(citations: Citation[]): boolean {
  return citations.length > 0 && citations.every(
    (citation) => citation.verified && citation.pdf_page_1based !== null
  );
}
