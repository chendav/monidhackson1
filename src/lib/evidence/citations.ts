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
