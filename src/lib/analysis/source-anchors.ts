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

function singleUnamendedBaseDocument(documents: SourceAnchorDocument[]) {
  const baseDocuments = documents.filter((document) => document.role === "base");
  return baseDocuments.length === 1 && documents.length === 1 &&
    baseDocuments[0].amendmentNumber === null
    ? baseDocuments[0]
    : null;
}

function uniqueLineIndex(lines: string[], pattern: RegExp) {
  const matches = lines.flatMap((line, index) => pattern.test(line) ? [index] : []);
  return matches.length === 1 ? matches[0] : null;
}

function exactCoverField(line: string, pattern: RegExp) {
  const match = pattern.exec(line);
  const value = match?.[1] ? displayText(match[1]) : "";
  return value || null;
}

const COVER_LABEL_LIKE_LINE = /^[\p{L}][\p{L}\p{N}&/()' .-]{0,80}:\s*/u;

/**
 * Recover only the three closed, labelled identity fields used by the Canadian RFP
 * cover template. The template must be unambiguous on physical page 1 and
 * must be the only base document in an unamended package.
 */
export function recoverStrictCoverAnchors(
  _draft: DraftAnalysis,
  documents: SourceAnchorDocument[]
): DraftAnalysis["claims"] {
  const document = singleUnamendedBaseDocument(documents);
  if (!document) return [];
  const coverPages = document.index.pages.filter((page) => page.pdfPage1Based === 1);
  if (coverPages.length !== 1) return [];

  const page = coverPages[0];
  const lines = page.text.split(/\r?\n/).map((line) => displayText(line));
  const returnBidsIndex = uniqueLineIndex(lines, /^return bids to:\s*$/i);
  const rfpIndex = uniqueLineIndex(lines, /^request for proposal\s*$/i);
  const proposalToIndex = uniqueLineIndex(lines, /^proposal to:\s*\S.*$/i);
  const offerBoundaryIndex = uniqueLineIndex(lines, /^we hereby offer\b/i);
  const titleIndex = uniqueLineIndex(lines, /^title:\s*\S.*$/i);
  const solicitationIndex = uniqueLineIndex(
    lines,
    /^solicitation no\.:\s*\S.*?\s+date:\s*.*$/i
  );
  if ([returnBidsIndex, rfpIndex, proposalToIndex, offerBoundaryIndex,
    titleIndex, solicitationIndex].some((index) => index === null)) return [];

  const ordered = [returnBidsIndex!, rfpIndex!, proposalToIndex!,
    offerBoundaryIndex!, titleIndex!, solicitationIndex!];
  if (!ordered.every((index, position) => position === 0 || ordered[position - 1] < index)) {
    return [];
  }

  const issuerLines = lines.slice(proposalToIndex!, offerBoundaryIndex!);
  const issuerFirst = exactCoverField(issuerLines[0], /^proposal to:\s*(.+)$/i);
  const issuerContinuation = issuerLines.slice(1);
  if (!issuerFirst || issuerContinuation.length > 2 || issuerContinuation.some((line) =>
    !line || COVER_LABEL_LIKE_LINE.test(line)
  )) return [];
  const issuer = displayText([issuerFirst, ...issuerContinuation].join(" "));

  const title = exactCoverField(lines[titleIndex!], /^title:\s*(.+)$/i);
  const solicitationNumber = exactCoverField(
    lines[solicitationIndex!],
    /^solicitation no\.:\s*(.+?)\s+date:\s*.*$/i
  );
  if (!title || !solicitationNumber || title.length > 500 || issuer.length > 500 ||
    solicitationNumber.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(solicitationNumber)) {
    return [];
  }

  const documentPrefix = document.index.documentSha256.slice(0, 12);
  const sourceClaim = (
    suffix: string,
    topic: string,
    value: string,
    quote: string,
    section: string
  ): DraftAnalysis["claims"][number] => ({
    claim_id: `server-anchor-${documentPrefix}-cover-${suffix}`,
    topic,
    claim_text: value,
    claim_type: "source",
    confidence: 1,
    document_sha256: document.index.documentSha256,
    amendment_number: document.amendmentNumber,
    effect: "add",
    citations: [{
      document_sha256: document.index.documentSha256,
      chunk_id: null,
      evidence_quote: quote,
      section
    }],
    supersedes_claim_ids: []
  });

  const issuerQuote = displayText(lines.slice(proposalToIndex!, offerBoundaryIndex!).join(" "));
  const titleQuote = displayText(lines[titleIndex!]);
  const solicitationQuote = `Solicitation No.: ${solicitationNumber}`;
  if ([issuerQuote, titleQuote, solicitationQuote].some((quote) => quote.length > 500)) {
    return [];
  }

  return [
    sourceClaim("title", "solicitation title", title, titleQuote, "Cover - Title"),
    sourceClaim(
      "solicitation-number",
      "solicitation number",
      solicitationNumber,
      solicitationQuote,
      "Cover - Solicitation No."
    ),
    sourceClaim("issuer", "issuer", issuer, issuerQuote, "Cover - Proposal To")
  ];
}

const STRUCTURAL_SECTION_HEADING = /^\s*(\d+(?:\.\d+)*)(\.)?\s+(\S.*)$/;
const NAMED_SECTION_BOUNDARY = /^\s*(?:part\s+\d+\b|annex\b|appendix\b)/i;
function topLevelDottedLineIsListItem(punctuation: string | undefined, title: string) {
  if (punctuation !== ".") return false;
  const words = title.trim().split(/\s+/);
  const lexicalWords = words.filter((word) => /[a-z]/i.test(word));
  const titleLike = lexicalWords.length > 0 && lexicalWords.every((word) =>
    /^[A-Z][A-Za-z'/-]*$/.test(word) || /^(?:and|or|of|the|to|for|in|on|with)$/i.test(word)
  );
  const sentenceLike = /\b(?:must|shall|will|should|may|can|is|are|was|were|has|have|requires?|submit(?:s|ted)?|send(?:s|sent)?|provide(?:s|d)?)\b/i
    .test(title) || /[.!?;:]$/.test(title);
  return sentenceLike && !titleLike;
}

function boundedSectionLines(
  lines: string[],
  headingIndex: number,
  root: string
): Array<{ text: string; section: string }> {
  const body: Array<{ text: string; section: string }> = [];
  const rootDepth = sectionDepth(root);
  let section = root;
  for (const rawLine of lines.slice(headingIndex + 1)) {
    if (NAMED_SECTION_BOUNDARY.test(rawLine)) break;
    const heading = STRUCTURAL_SECTION_HEADING.exec(rawLine);
    if (heading) {
      const number = heading[1];
      if (!number.includes(".") && topLevelDottedLineIsListItem(heading[2], heading[3])) {
        body.push({ text: displayText(heading[3]), section });
        continue;
      }
      if (!number.startsWith(`${root}.`) || sectionDepth(number) <= rootDepth) break;
      section = number;
      continue;
    }
    const text = displayText(rawLine);
    if (text) body.push({ text, section });
  }
  return body;
}

/**
 * Retained as a compatibility seam for callers and historical tests. Source
 * anchors no longer interpret English submission semantics; only the verified
 * private Agent ledger can authorize a submission method.
 */
export function recoverSubmissionMethodAnchors(
  _draft: DraftAnalysis,
  _documents: SourceAnchorDocument[]
): DraftAnalysis["claims"] {
  void _draft;
  void _documents;
  return [];
}

interface EvaluationSentence {
  text: string;
  section: string;
}

const NUMBERED_BASIS_OF_SELECTION_HEADING =
  /^\s*(\d+(?:\.\d+)+)\.?\s+basis of selection\s*$/i;
const NON_DEFINITIVE_EVALUATION_SECTION =
  /\b(?:if|unless|provided that|assuming|pending|subject to|proposed|draft|potential|anticipated|example|for example|for instance|illustration|hypothetical|previously|formerly|historically|prior version|used to|not|never|no longer|cannot|may|might|could|would|should)\b/i;
const CALCULATED_SELECTION_SECTION =
  /\b(?:formula|calculation|calculate|points? awarded|price points?|score calculation|weighted|weighting|ratio|divide(?:d)? by|multipl(?:y|ied|ier))\b/i;
const PERCENTAGE_SELECTION_SECTION =
  /\b(?:technical|financial|price)\b[^.!?\n]{0,100}\b\d+(?:\.\d+)?\s*(?:%|percent\b|per cent\b)|\b\d+(?:\.\d+)?\s*(?:%|percent\b|per cent\b)[^.!?\n]{0,100}\b(?:technical|financial|price)\b/i;

function completeEvaluationSentences(lines: Array<{ text: string; section: string }>) {
  const groups: Array<{ section: string; lines: string[] }> = [];
  for (const line of lines) {
    const current = groups.at(-1);
    if (!current || current.section !== line.section) {
      groups.push({ section: line.section, lines: [line.text] });
    } else {
      current.lines.push(line.text);
    }
  }
  return groups.flatMap((group): EvaluationSentence[] => displayText(group.lines.join(" "))
    .split(/(?<=[.!?])\s+(?=[A-Z])/u)
    .map((text) => text.trim())
    .filter((text) => text.length >= 24 && text.length <= 500 && /[.!?]$/.test(text))
    .map((text) => ({ text, section: group.section })));
}

function selectionSignatures(value: string) {
  const signatures = new Set<string>();
  if (/\blowest evaluated (?:total )?price\b/i.test(value)) {
    signatures.add("lowest-evaluated-price");
  }
  if (/\blowest (?!evaluated\b)(?:total )?price\b/i.test(value)) signatures.add("lowest-price");
  if (/\bhighest combined rating\b/i.test(value)) signatures.add("highest-combined-rating");
  if (/\bbest value\b/i.test(value)) signatures.add("best-value");
  if (/\bhighest (?:technical )?score\b/i.test(value)) signatures.add("highest-score");
  return signatures;
}

/**
 * Recover Edmonton-style evaluation gates only from one complete, affirmative
 * Basis of Selection section. This deliberately does not infer weights,
 * thresholds, amendment operations, or selection formulas.
 */
export function recoverBasisOfSelectionEvaluationAnchors(
  _draft: DraftAnalysis,
  documents: SourceAnchorDocument[]
): DraftAnalysis["evaluation"]["rules"] {
  const document = singleUnamendedBaseDocument(documents);
  if (!document) return [];

  const candidates = document.index.pages.flatMap((page) => {
    if (/(?:^|\n)\s*(?:table of )?contents\s*(?:\n|$)/i.test(page.text)) return [];
    const lines = page.text.split(/\r?\n/);
    return lines.flatMap((line, lineIndex) => {
      const heading = NUMBERED_BASIS_OF_SELECTION_HEADING.exec(line);
      return heading ? [{ page, lines, lineIndex, number: heading[1] }] : [];
    });
  });
  if (candidates.length !== 1) return [];

  const candidate = candidates[0];
  const body = boundedSectionLines(candidate.lines, candidate.lineIndex, candidate.number);
  const sectionText = displayText(body.map((line) => line.text).join(" "));
  if (!sectionText || NON_DEFINITIVE_EVALUATION_SECTION.test(sectionText) ||
    CALCULATED_SELECTION_SECTION.test(sectionText) ||
    PERCENTAGE_SELECTION_SECTION.test(sectionText)) return [];

  const signatures = selectionSignatures(sectionText);
  if (signatures.size > 1 ||
    (signatures.size === 1 && !signatures.has("lowest-evaluated-price"))) return [];
  const sentences = completeEvaluationSentences(body);
  const mandatory = sentences.filter((sentence) =>
    /^(?:a|the) (?:bid|proposal|tender|offer) must comply with the requirements of the (?:bid solicitation|solicitation|tender) and meet all mandatory technical evaluation criteria to be declared responsive\.$/i
      .test(sentence.text)
  );
  const selection = sentences.filter((sentence) =>
    /^the responsive (?:bid|proposal|tender|offer) with the lowest evaluated (?:total )?price will be recommended for award of (?:a|the) contract\.$/i
      .test(sentence.text)
  );
  const decisionSentences = sentences.filter((sentence) =>
    /\b(?:award(?:ed|ing)?|selection|select(?:ed|ion)?|recommend(?:ed|ation)?|rank(?:ed|ing)?)\b/i
      .test(sentence.text)
  );
  if (mandatory.length !== 1 || selection.length > 1 || decisionSentences.length > 1 ||
    (selection.length === 1 && (signatures.size !== 1 || decisionSentences.length !== 1 ||
      decisionSentences[0].text !== selection[0].text)) ||
    (selection.length === 0 && decisionSentences.length !== 0)) return [];

  const documentPrefix = document.index.documentSha256.slice(0, 12);
  const rule = (
    suffix: string,
    topic: string,
    field: DraftAnalysis["evaluation"]["rules"][number]["field"],
    value: string,
    sentence: EvaluationSentence
  ): DraftAnalysis["evaluation"]["rules"][number] => ({
    id: `server-anchor-${documentPrefix}-p${candidate.page.pdfPage1Based}-evaluation-${suffix}`,
    topic,
    document_sha256: document.index.documentSha256,
    amendment_number: document.amendmentNumber,
    effect: "add",
    field,
    value,
    citations: [{
      document_sha256: document.index.documentSha256,
      chunk_id: null,
      evidence_quote: sentence.text,
      section: sentence.section
    }]
  });

  return [
    rule("mandatory-gate", "mandatory evaluation gate", "mandatory_gate", "true", mandatory[0]),
    ...(selection.length === 1 ? [rule(
      "selection-method",
      "award selection method",
      "selection_method",
      "Lowest evaluated price",
      selection[0]
    )] : [])
  ];
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

interface SecurityRequirementPattern {
  key: string;
  topic: string;
  pattern: RegExp;
}

const SECURITY_REQUIREMENT_PATTERNS: SecurityRequirementPattern[] = [
  {
    key: "afr-registration",
    topic: "contract security program AFR registration requirement",
    pattern: /\b(?:the\s+)?(?:bidder|offeror|proponent|tenderer)\s+must\s+provide\s+(?:a|an)\s+completed\s+[^.]{0,220}?\bapplication\s+for\s+registration\s*\(\s*afr\s*\)\s+form[^.]{0,180}\./giu
  },
  {
    key: "organization-clearance",
    topic: "organization security clearance requirement",
    pattern: /\b(?:the\s+)?(?:bidder|offeror|proponent|tenderer)\s+must\s+hold\s+a\s+valid\s+organization\s+security\s+clearance[^.]{0,240}\./giu
  },
  {
    key: "designated-organization-screening",
    topic: "designated organization screening DOS requirement",
    pattern: /\b(?:the\s+)?contractor\s+must\s*,?\s+at\s+all\s+times[^.]{0,180}?\bhold\s+a\s+valid\s+designated\s+organization\s+screening\s*\(\s*dos\s*\)[^.]{0,180}\./giu
  },
  {
    key: "personnel-reliability-status",
    topic: "personnel reliability status requirement",
    pattern: /\b(?:the\s+)?contractor\s+personnel[^.]{0,220}?\bmust\s+each\s+hold\s+a\s+valid\s+reliability\s+status[^.]{0,180}\./giu
  }
];

const NUMBERED_SECURITY_HEADING =
  /^\s*(\d+(?:\.\d+)*)\.?\s+security requirements?\b(?:\s*[-\u2010-\u2015:]\s*[^\r\n]*)?\s*$/gimu;
const NUMBERED_HEADING_LINE = /^\s*(\d+(?:\.\d+)*)(\.)?\s+(\S[^\r\n]*)$/gimu;

function dottedTopLevelLineLooksLikeOrderedItem(number: string, title: string, root: string) {
  const candidateOrdinal = Number.parseInt(number, 10);
  const rootOrdinal = Number.parseInt(root.split(".")[0], 10);
  const trimmed = title.trim();
  const words = trimmed.split(/\s+/);
  const sentenceStart = /^(?:at|before|after|for|if|when|where|while|unless|the|a|an|each|all|any|subcontracts?|bidders?|contractors?)\b/i
    .test(trimmed);
  const predicateOrTerminator = /\b(?:must|shall|will|should|may|can|is|are|was|were|has|have|refer(?:s)?|apply|applies)\b/
    .test(trimmed) || /[:.!?]$/.test(trimmed);
  const lexicalWords = words.filter((word) => /[a-z]/i.test(word));
  const titleLike = lexicalWords.length > 0 && lexicalWords.every((word) =>
    /^[A-Z][A-Za-z'/-]*$/.test(word) || /^(?:and|or|of|the|to|for|in|on|with)$/i.test(word)
  );
  return Number.isFinite(candidateOrdinal) && Number.isFinite(rootOrdinal) &&
    candidateOrdinal <= rootOrdinal && sentenceStart && predicateOrTerminator && !titleLike;
}

function securitySectionForMatch(text: string, matchIndex: number): string | null {
  const securityHeadings = [...text.matchAll(NUMBERED_SECURITY_HEADING)].filter((heading) =>
    heading.index !== undefined && heading.index + heading[0].length <= matchIndex
  );
  const securityHeading = securityHeadings.at(-1);
  if (!securityHeading || securityHeading.index === undefined) return null;

  const root = securityHeading[1];
  const rootDepth = sectionDepth(root);
  let section = root;
  for (const candidate of text.matchAll(NUMBERED_HEADING_LINE)) {
    if (candidate.index === undefined || candidate.index <= securityHeading.index) continue;
    if (candidate.index >= matchIndex) break;
    const number = candidate[1];
    // A top-level "1. First condition" line is ordinarily an ordered-list
    // item, not a section boundary. A top-level number without that list
    // punctuation (for example "3 Other Requirements") is treated as a
    // conservative boundary. Decimal numbers are section-like either way.
    if (!number.includes(".") && candidate[2] === "." &&
      dottedTopLevelLineLooksLikeOrderedItem(number, candidate[3], root)) continue;
    if (number === root) continue;
    if (!number.startsWith(`${root}.`)) return null;
    const depth = sectionDepth(number);
    if (depth <= rootDepth) return null;
    section = number;
  }
  return section;
}

/**
 * Recover a small closed set of explicit security obligations only when they
 * occur inside a numbered Security Requirements section in a base tender.
 * This prevents a model omission from hiding distinct organizational and
 * personnel clearances without inferring amendment semantics.
 */
export function recoverSecurityRequirementAnchors(
  _draft: DraftAnalysis,
  documents: SourceAnchorDocument[]
): DraftAnalysis["requirements"] {
  // This fallback intentionally has no amendment-operation parser. In a
  // multi-document package, publishing a base-only recovered clause could
  // make superseded text look current when a model misses the amendment.
  // Leave amended packages to the ordinary verified reconciliation path.
  if (documents.some((document) => document.role === "amendment")) return [];
  const recovered: DraftAnalysis["requirements"] = [];
  for (const document of documents) {
    if (document.role !== "base") continue;
    for (const page of document.index.pages) {
      const text = page.text;
      for (const definition of SECURITY_REQUIREMENT_PATTERNS) {
        for (const match of text.matchAll(definition.pattern)) {
          if (match.index === undefined) continue;
          const section = securitySectionForMatch(text, match.index);
          const clause = displayText(match[0]);
          if (!section || clause.length < 24 || clause.length > 500) continue;
          if (recovered.some((requirement) =>
            requirement.document_sha256 === document.index.documentSha256 &&
            requirement.id.endsWith(`-security-${definition.key}`))) continue;
          recovered.push({
            id: `server-anchor-${document.index.documentSha256.slice(0, 12)}-p${page.pdfPage1Based}-security-${definition.key}`,
            topic: definition.topic,
            document_sha256: document.index.documentSha256,
            amendment_number: document.amendmentNumber,
            effect: "add",
            category: "security",
            text: clause,
            evidence_needed: null,
            consequence: null,
            citations: [{
              document_sha256: document.index.documentSha256,
              chunk_id: null,
              evidence_quote: clause,
              section
            }]
          });
        }
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
