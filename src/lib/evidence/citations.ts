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

const TIME_ZONE_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:coordinated universal time|universal time coordinated|utc)\b/g, "utc"],
  [/\b(?:greenwich mean time|gmt)\b/g, "gmt"],
  [/\b(?:mountain standard time|mst)\b/g, "mst"],
  [/\b(?:mountain daylight time|mdt)\b/g, "mdt"],
  [/\b(?:central standard time|cst)\b/g, "cst"],
  [/\b(?:central daylight time|cdt)\b/g, "cdt"],
  [/\b(?:eastern standard time|est)\b/g, "est"],
  [/\b(?:eastern daylight time|edt)\b/g, "edt"],
  [/\b(?:pacific standard time|pst)\b/g, "pst"],
  [/\b(?:pacific daylight time|pdt)\b/g, "pdt"],
  [/\b(?:atlantic standard time|ast)\b/g, "ast"],
  [/\b(?:atlantic daylight time|adt)\b/g, "adt"],
  [/\b(?:newfoundland standard time|nst)\b/g, "nst"],
  [/\b(?:newfoundland daylight time|ndt)\b/g, "ndt"]
];

const TIME_ZONE_UTC_OFFSETS = new Map([
  ["utc", "+00:00"], ["gmt", "+00:00"],
  ["mst", "-07:00"], ["mdt", "-06:00"],
  ["cst", "-06:00"], ["cdt", "-05:00"],
  ["est", "-05:00"], ["edt", "-04:00"],
  ["pst", "-08:00"], ["pdt", "-07:00"],
  ["ast", "-04:00"], ["adt", "-03:00"],
  ["nst", "-03:30"], ["ndt", "-02:30"]
]);

function recordObjectiveModifiers(value: string, tokens: Set<string>) {
  for (const [pattern, canonical] of TIME_ZONE_ALIASES) {
    if (pattern.test(value)) {
      tokens.add(`timezone:${canonical}`);
      const offset = TIME_ZONE_UTC_OFFSETS.get(canonical);
      if (offset) tokens.add(`utc-offset:${offset}`);
    }
    pattern.lastIndex = 0;
  }

  for (const match of value.matchAll(/(?<![\p{L}\p{N}])([+\-])(\d{2}):(\d{2})\b/gu)) {
    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    if (hours <= 14 && minutes <= 59) tokens.add(`utc-offset:${match[1]}${match[2]}:${match[3]}`);
  }
  for (const match of value.matchAll(/[t ]\d{2}:\d{2}(?::\d{2})?([+\-])(\d{2}):(\d{2})\b/gu)) {
    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    if (hours <= 14 && minutes <= 59) tokens.add(`utc-offset:${match[1]}${match[2]}:${match[3]}`);
  }

  for (const match of value.matchAll(/(?<![\p{L}\p{N}])(\d+(?:\.\d+)?)\s*(?:%|per\s*cent|percent(?:age)?)(?![\p{L}])/gu)) {
    tokens.add(`percent:${canonicalNumber(match[1])}`);
  }
  for (const match of value.matchAll(/\b(cad|usd|gbp|eur|aud|nzd|jpy|chf)\b/g)) {
    tokens.add(`currency:${match[1]}`);
  }
  for (const match of value.matchAll(/\b(thousand|million|billion|trillion)\b/g)) {
    tokens.add(`magnitude:${match[1]}`);
  }

  if (/\b(?:at least|minimum(?: of)?|no less than)\b/.test(value)) tokens.add("bound:minimum");
  if (/\b(?:at most|maximum(?: of)?|up to|no more than|not exceed(?:ing)?)\b/.test(value)) {
    tokens.add("bound:maximum");
  }
  if (/\b(?:exactly|equal to)\b/.test(value)) tokens.add("bound:exact");
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

  // These modifiers are independently objective. Capturing them prevents a
  // numerically identical assertion from silently changing MDT to EST, CAD to
  // USD, a percentage to an unrelated count, or a maximum into a minimum.
  recordObjectiveModifiers(remainder, tokens);

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

  // Explicit UTC offsets were recorded before date/time ranges were blanked.
  // Remove their digits here so they are not also treated as ordinary numbers.
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
