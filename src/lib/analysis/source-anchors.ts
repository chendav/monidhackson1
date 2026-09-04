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

const NUMBERED_SUMMARY_HEADING = /^\s*(\d+(?:\.\d+)*)\.?\s+summary\s*$/i;
const NUMBERED_SECTION_HEADING = /^\s*(\d+(?:\.\d+)*)\.?\s+\S/;
const SUMMARY_EXCLUDED_CONTENT =
  /\b(?:table of contents|security requirements?|security clearance|security screening|for more information|refer to|consult|website|web site|https?:\/\/|www\.)\b/i;
const SUMMARY_META_CONTENT =
  /\b(?:this (?:bid )?solicitation is divided|the annexes include|instructions? to bidders?|submission deadline|closing date|enquir(?:y|ies)|debriefings?|ignore (?:all|any|the|previous)|system prompt|language model|artificial intelligence|follow (?:these|the) instructions?|execute (?:code|commands?)|call (?:a )?tool|browse the (?:web|internet)|reveal (?:the )?prompt)\b/i;
const NON_AFFIRMATIVE_SUMMARY_CONTENT =
  /\b(?:if|unless|subject to|provided that|assuming|pending|proposed|potential|anticipated)\b|\b(?:may|might|could|would|should)\b|\b(?:is|are|was|were|must|shall|will|does|do|did|can)\s+not\b|\b(?:never|no longer|cannot)\b/i;
const SCOPE_CONTENT =
  /\b(?:work|services?|goods?|suppl(?:y|ies)|deliverables?|assets?|equipment|facilit(?:y|ies)|sites?|locations?|projects?|contracts?|solutions?|systems?|products?|streams?|maintenance|repairs?|construction|installation|support|operations?)\b/i;

interface SummarySentence {
  page: number;
  text: string;
  section: string;
}

function sectionDepth(value: string) {
  return value.split(".").length;
}

function completeSummarySentences(value: string): string[] {
  const withoutPageFurniture = value
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:request for proposal\s*:|page\s+\d+\s+of\s+\d+)\s*$/i.test(line))
    .join(" ");
  const normalized = displayText(withoutPageFurniture)
    .replace(/^\d+(?:\.\d+)*\.?\s+/, "");
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+(?=(?:\d+(?:\.\d+)*\.?\s+)?[A-Z])/u)
    .map((sentence) => sentence.replace(/^\d+(?:\.\d+)*\.?\s+/, "").trim())
    .filter((sentence) => /^[\p{L}\p{N}]/u.test(sentence) && /[.!?]$/.test(sentence) &&
      sentence.length >= 24 && sentence.length <= 500);
}

function affirmativeSubstantiveSummarySentence(value: string) {
  if (SUMMARY_EXCLUDED_CONTENT.test(value) || SUMMARY_META_CONTENT.test(value) ||
    NON_AFFIRMATIVE_SUMMARY_CONTENT.test(value)) return false;
  return (value.match(/[\p{L}]{2,}/gu)?.length ?? 0) >= 5;
}

function summarySectionSentences(document: SourceAnchorDocument): SummarySentence[] {
  let active: { number: string; depth: number; section: string } | null = null;
  const slices: Array<{ page: number; text: string; section: string }> = [];

  for (const page of document.index.pages) {
    const lines = page.text.split(/\r?\n/);
    if (!active && /(?:^|\n)\s*(?:table of )?contents\s*(?:\n|$)/i.test(page.text)) continue;
    let body: string[] = [];
    for (const line of lines) {
      if (!active) {
        const heading = NUMBERED_SUMMARY_HEADING.exec(line);
        if (!heading) continue;
        active = {
          number: heading[1],
          depth: sectionDepth(heading[1]),
          section: `${heading[1]} Summary`
        };
        continue;
      }

      const nextHeading = NUMBERED_SECTION_HEADING.exec(line);
      if (nextHeading && sectionDepth(nextHeading[1]) <= active.depth &&
        nextHeading[1] !== active.number) {
        if (body.length > 0) {
          slices.push({ page: page.pdfPage1Based, text: body.join("\n"), section: active.section });
        }
        active = null;
        body = [];
        break;
      }
      body.push(line);
    }
    if (active && body.length > 0) {
      slices.push({ page: page.pdfPage1Based, text: body.join("\n"), section: active.section });
    }
    // One physical, numbered Summary section is enough. Continuing after its
    // boundary could accidentally bind a later annex summary to the package.
    if (!active && slices.length > 0) break;
  }

  return slices.flatMap((slice) => completeSummarySentences(slice.text).map((text) => ({
    page: slice.page,
    text,
    section: slice.section
  })));
}

/**
 * Recover only prose physically enclosed by a numbered Summary section in a
 * base solicitation. These source-owned claims give materialization a safe
 * alternative when a model-generated summary is missing or paraphrased.
 */
export function recoverSummarySectionAnchors(
  _draft: DraftAnalysis,
  documents: SourceAnchorDocument[]
): DraftAnalysis["claims"] {
  const recovered: DraftAnalysis["claims"] = [];
  for (const document of documents) {
    if (document.role !== "base") continue;
    const substantive = summarySectionSentences(document)
      .filter((sentence) => affirmativeSubstantiveSummarySentence(sentence.text));
    const overview = substantive[0];
    if (!overview) continue;

    const add = (sentence: SummarySentence, topic: "overview" | "scope", ordinal: number) => {
      recovered.push({
        claim_id: `server-anchor-${document.index.documentSha256.slice(0, 12)}-p${sentence.page}-summary-${topic}-${ordinal}`,
        topic,
        claim_text: sentence.text,
        claim_type: "source",
        confidence: 1,
        document_sha256: document.index.documentSha256,
        amendment_number: document.amendmentNumber,
        effect: "add",
        citations: [{
          document_sha256: document.index.documentSha256,
          chunk_id: null,
          evidence_quote: sentence.text,
          section: sentence.section
        }],
        supersedes_claim_ids: []
      });
    };

    add(overview, "overview", 1);
    substantive.slice(1)
      .filter((sentence) => SCOPE_CONTENT.test(sentence.text))
      .slice(0, 25)
      .forEach((sentence, index) => add(sentence, "scope", index + 1));
  }
  return recovered;
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
