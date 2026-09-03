import type { DraftAnalysis } from "@/lib/analysis/draft";
import type { CitationDocument } from "@/lib/evidence/citations";
import { normalizeEvidenceText } from "@/lib/pdf/page-index";

export type SourceAnchorDocument = CitationDocument & {
  role: "base" | "amendment";
  amendmentNumber: string | null;
};

function displayText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clauseThroughFirstBoundary(value: string) {
  const boundedResources = /\b(?:propose|provide)\s+up to\s+\w+\s*\(\s*\d+\s*\)\s+resources?\s+and\s+provide\s+detailed\s+resumes?\s+for\s+each\b/i.exec(value);
  if (boundedResources) {
    return value.slice(0, boundedResources.index + boundedResources[0].length).trim();
  }
  const boundary = /[.:](?=\s|$)/.exec(value);
  return (boundary ? value.slice(0, boundary.index + 1) : value).trim();
}

export function recoverMandatoryTableAnchors(
  _draft: DraftAnalysis,
  documents: SourceAnchorDocument[]
): DraftAnalysis["requirements"] {
  const recovered: DraftAnalysis["requirements"] = [];
  for (const document of documents) {
    // Without amendment-operation language, a table row cannot safely be
    // classified as add vs replace. Keep deterministic recovery to the base
    // document and let amendment extraction fail closed if the model omits it.
    if (document.role !== "base") continue;
    for (const page of document.index.pages) {
      if (!/\bmandatory criteria\b/i.test(page.text)) continue;
      const text = displayText(page.text);
      const criterionPattern = /\b(M\d{1,3})\s+((?:the\s+)?(?:bidder|offeror|proponent|tenderer)\s+(?:must|shall|is required to)\b[\s\S]{1,800}?)(?=\s+M\d{1,3}\b|\s+ANNEX\b|$)/giu;
      for (const match of text.matchAll(criterionPattern)) {
        const label = match[1].toUpperCase();
        const clause = clauseThroughFirstBoundary(match[2]);
        if (recovered.some((requirement) =>
            requirement.document_sha256 === document.index.documentSha256 &&
            requirement.citations.some((citation) => citation.section === label))) continue;
        if (!clause || clause.length > 500) continue;
        recovered.push({
          id: `server-anchor-${document.index.documentSha256.slice(0, 12)}-p${page.pdfPage1Based}-${label}`,
          topic: `${label} mandatory criterion`,
          document_sha256: document.index.documentSha256,
          amendment_number: document.amendmentNumber,
          effect: "add",
          category: "mandatory",
          text: clause,
          evidence_needed: null,
          consequence: null,
          citations: [{
            document_sha256: document.index.documentSha256,
            chunk_id: null,
            evidence_quote: clause,
            section: label
          }]
        });
      }
    }
  }
  return recovered;
}

interface AnnexCandidate {
  value: string;
  quote: string;
  page: number;
}

function sentenceContext(text: string, matchStart: number, matchEnd: number) {
  const prefix = text.slice(0, matchStart);
  const start = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("; "));
  const suffix = text.slice(matchEnd);
  const trailingBoundary = /[.;](?=\s|$)/.exec(suffix);
  const end = trailingBoundary ? matchEnd + trailingBoundary.index + 1 : text.length;
  return text.slice(start < 0 ? 0 : start + 2, end).trim();
}

function headingEvidenceContext(text: string, matchStart: number, matchEnd: number) {
  const prefix = text.slice(0, matchStart).trimEnd();
  if (!prefix) return text.slice(matchStart, matchEnd).trim();
  const withoutTerminal = prefix.replace(/[.;:]\s*$/u, "");
  const priorBoundary = Math.max(
    withoutTerminal.lastIndexOf(". "),
    withoutTerminal.lastIndexOf("; ")
  );
  const boundedStart = Math.max(0, prefix.length - 300);
  const start = priorBoundary >= boundedStart ? priorBoundary + 2 : boundedStart;
  return text.slice(start, matchEnd).trim();
}

function securityChecklistAnnexCandidates(document: SourceAnchorDocument): AnnexCandidate[] {
  const candidates: AnnexCandidate[] = [];
  for (const page of document.index.pages) {
    const text = displayText(page.text);
    const relationPattern = /security requirements?\s+check\s*list(?:\s+and\s+security guide\s*\(\s*if applicable\s*\))?\s*,?\s+attached at\s+annex\s*["“”']?\s*([a-z])\s*["“”']?/giu;
    for (const match of text.matchAll(relationPattern)) {
      const quote = sentenceContext(text, match.index, match.index + match[0].length);
      const conditionScan = quote.replace(/\(\s*if applicable\s*\)/giu, "");
      if (/\b(?:if|when|provided|subject to|conditional(?:ly)?|pending|assuming|once|upon)\b/i
        .test(conditionScan)) continue;
      if (quote.length > 0 && quote.length <= 500) {
        candidates.push({ value: `Annex ${match[1].toUpperCase()}`, quote, page: page.pdfPage1Based });
      }
    }
    const headingPattern = /\bannex\s*["“”']?\s*([a-z])\s*["“”']?\s*[-:]\s*security requirements?\s+check\s*list\b/giu;
    for (const match of text.matchAll(headingPattern)) {
      const trailing = text.slice(match.index + match[0].length, match.index + match[0].length + 160);
      // A table-of-contents entry is only a pointer. Prefer the physical annex
      // heading and never cite a dot-leader/page-number entry as the annex itself.
      if (/^\s*\.{3,}\s*\d+\b/u.test(trailing)) continue;
      candidates.push({
        value: `Annex ${match[1].toUpperCase()}`,
        quote: headingEvidenceContext(text, match.index, match.index + match[0].length),
        page: page.pdfPage1Based
      });
    }
  }
  return candidates;
}

export function recoverSecurityChecklistConflictAnchors(
  _draft: DraftAnalysis,
  documents: SourceAnchorDocument[]
): DraftAnalysis["claims"] {
  const recovered: DraftAnalysis["claims"] = [];
  for (const document of documents) {
    const candidates = securityChecklistAnnexCandidates(document);
    if (new Set(candidates.map((candidate) => normalizeEvidenceText(candidate.value))).size < 2) continue;
    for (const candidate of candidates) {
      const alreadyPresent = recovered.some((claim) =>
        claim.document_sha256 === document.index.documentSha256 &&
        normalizeEvidenceText(claim.claim_text) === normalizeEvidenceText(candidate.value) &&
        claim.citations.some((citation) =>
          /security requirements?\s+check\s*list/i.test(citation.evidence_quote)
        )
      );
      if (alreadyPresent) continue;
      recovered.push({
        claim_id: `server-anchor-${document.index.documentSha256.slice(0, 12)}-p${candidate.page}-${normalizeEvidenceText(candidate.value).replace(/\s+/g, "-")}`,
        topic: "security requirements checklist annex label",
        claim_text: candidate.value,
        claim_type: "source",
        confidence: 1,
        document_sha256: document.index.documentSha256,
        amendment_number: document.amendmentNumber,
        effect: "add",
        citations: [{
          document_sha256: document.index.documentSha256,
          chunk_id: null,
          evidence_quote: candidate.quote,
          section: "Security Requirements Checklist"
        }],
        supersedes_claim_ids: []
      });
    }
  }
  return recovered;
}
