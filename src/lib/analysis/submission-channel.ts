import { z } from "zod";
import { sha256Hex, stableJson } from "@/lib/crypto";
import type { CitationDocument } from "@/lib/evidence/citations";

export const SUBMISSION_LEDGER_VERSION = "submission-ledger-v1" as const;
export const SUBMISSION_WINDOW_UTF16 = 3_200;
export const SUBMISSION_WINDOW_OVERLAP_UTF16 = 400;
export const MAX_SUBMISSION_COVERAGE_UNITS = 160;
export const MAX_SUBMISSION_RELATIONS_PER_UNIT = 10;
export const MAX_SUBMISSION_QUOTE_UTF16 = 500;
export const MIN_SUBMISSION_CONFIDENCE = 0.9;

export type SubmissionChannelSignature =
  | "email"
  | "portal"
  | "electronic"
  | "fax"
  | "postal_mail"
  | "courier"
  | "hand_delivery";

export type SubmissionChannelHint = SubmissionChannelSignature | "unspecified";

export interface SubmissionOccurrence {
  occurrence_id: string;
  channel_hint: SubmissionChannelSignature;
  mention_start_utf16: number;
  mention_end_utf16: number;
}

/**
 * Temporary, private source-text object. It is created from PDF.js text and is
 * scrubbed before the result is persisted. Offsets are JavaScript string
 * offsets (UTF-16 code units) into the authoritative raw page text.
 */
export interface SubmissionCandidate {
  candidate_id: string;
  document_sha256: string;
  role: "base" | "amendment";
  amendment_number: string | null;
  pdf_page_1based: number;
  printed_page_label: string | null;
  page_text_sha256: string;
  section: string | null;
  source_start_utf16: number;
  source_end_utf16: number;
  source_window: string;
  channel_hint: SubmissionChannelHint;
  relation_capacity: number;
  focus_occurrence: SubmissionOccurrence | null;
  occurrences: SubmissionOccurrence[];
}

export interface SubmissionCandidateLedger {
  ledger_version: typeof SUBMISSION_LEDGER_VERSION;
  ledger_digest: string;
  candidates: SubmissionCandidate[];
  expected_page_count: number;
  covered_page_count: number;
  metadata_complete: boolean;
  capacity_exceeded: boolean;
}

const SubmissionChannelSchema = z.enum([
  "email",
  "portal",
  "electronic",
  "fax",
  "postal_mail",
  "courier",
  "hand_delivery",
  "unspecified"
]);

export const SubmissionRelationDecisionSchema = z.object({
  relation_start_utf16: z.number().int().nonnegative(),
  relation_end_utf16: z.number().int().positive(),
  subject_scope: z.enum(["whole_bid", "question", "artifact", "other", "ambiguous"]),
  modality: z.enum(["required", "permitted", "prohibited", "conditional", "unknown"]),
  channel: SubmissionChannelSchema,
  condition_start_utf16: z.number().int().nonnegative().nullable(),
  condition_end_utf16: z.number().int().positive().nullable(),
  confidence: z.number().min(0).max(1)
});

export type SubmissionRelationDecision = z.infer<typeof SubmissionRelationDecisionSchema>;

export const SubmissionCoverageDecisionSchema = z.object({
  candidate_id: z.string().min(1).max(100),
  document_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pdf_page_1based: z.number().int().positive(),
  relations: z.array(SubmissionRelationDecisionSchema).max(MAX_SUBMISSION_RELATIONS_PER_UNIT)
});

export type SubmissionCoverageDecision = z.infer<typeof SubmissionCoverageDecisionSchema>;

export const SubmissionBatchAdjudicationSchema = z.object({
  batch_id: z.string().regex(/^[a-f0-9]{64}$/),
  ledger_digest: z.string().regex(/^[a-f0-9]{64}$/),
  ordered_candidate_ids: z.array(z.string().min(1).max(100)).max(MAX_SUBMISSION_COVERAGE_UNITS),
  ordered_source_fragment_ids: z.array(z.string().min(1).max(100)).max(1_000),
  coverage_units: z.array(SubmissionCoverageDecisionSchema).max(MAX_SUBMISSION_COVERAGE_UNITS)
});

export type SubmissionBatchAdjudication = z.infer<typeof SubmissionBatchAdjudicationSchema>;

export interface SubmissionBatchBinding {
  batch_id: string;
  ledger_digest: string;
  ordered_candidate_ids: string[];
  ordered_source_fragment_ids: string[];
  prompt_injection_tainted: boolean;
}

export const SUBMISSION_UNRESOLVED_REASON_KEYS = [
  "capacity", "incomplete_page_coverage", "invalid_amendment_metadata", "missing_batch",
  "duplicate_batch", "unknown_batch", "ledger_digest_mismatch", "batch_manifest_mismatch",
  "missing_candidate", "duplicate_candidate", "unknown_candidate", "sha_mismatch",
  "page_mismatch", "channel_mismatch", "offset_mismatch", "quote_too_long",
  "condition_mismatch", "low_confidence", "semantic_uncertainty", "overlap_disagreement",
  "prompt_injection", "draft_disagreement"
] as const;

export type SubmissionUnresolvedReason = typeof SUBMISSION_UNRESOLVED_REASON_KEYS[number];

export interface RedactedSubmissionRelation {
  occurrence_key: string;
  document_sha256: string;
  role: "base" | "amendment";
  amendment_number: string | null;
  pdf_page_1based: number;
  printed_page_label: string | null;
  page_text_sha256: string;
  section: string | null;
  relation_start_utf16: number;
  relation_end_utf16: number;
  subject_scope: SubmissionRelationDecision["subject_scope"];
  modality: SubmissionRelationDecision["modality"];
  channel: SubmissionChannelHint;
  has_condition_or_scope: boolean;
  condition_or_scope_sha256: string | null;
  confidence: number;
  evidence_quote: string | null;
  evidence_quote_sha256: string;
}

export interface VerifiedSubmissionRecord {
  candidate_id: string;
  document_sha256: string;
  pdf_page_1based: number;
  page_text_sha256: string;
  disposition: "verified" | "unresolved";
  reason: SubmissionUnresolvedReason | null;
  relations: RedactedSubmissionRelation[];
}

/** This is the only submission artifact allowed past raw-text cleanup. */
export interface VerifiedSubmissionAdjudication {
  ledger_version: typeof SUBMISSION_LEDGER_VERSION;
  ledger_digest: string;
  expected_candidate_count: number;
  verified_candidate_count: number;
  expected_page_count: number;
  covered_page_count: number;
  expected_source_fragment_count: number;
  verified_source_fragment_count: number;
  expected_batch_count: number;
  verified_batch_count: number;
  complete: boolean;
  unresolved_reasons: SubmissionUnresolvedReason[];
  records: VerifiedSubmissionRecord[];
}

export type SubmissionChannelResolution =
  | {
      status: "unique";
      channel: SubmissionChannelSignature;
      decisive: RedactedSubmissionRelation;
    }
  | {
      status: "none" | "possible_only" | "multiple" | "contradicted" | "unresolved";
      channel: null;
      decisive: null;
    };

// Keep lexical discovery deliberately separate from English subject, modality,
// polarity, and condition semantics. Those belong exclusively to the Agent.
const CHANNEL_PATTERNS: ReadonlyArray<readonly [SubmissionChannelSignature, RegExp]> = [
  ["email", /\be-?mail(?:ed|ing|s)?\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu],
  ["portal", /\b(?:portal|canadabuys|buyandsell|epost|e-?procurement)\b/giu],
  ["electronic", /\belectronic(?:ally)?\b/giu],
  ["fax", /\b(?:fax|facsimile)(?:ed|ing|es)?\b/giu],
  ["postal_mail", /\b(?:postal mail|registered mail|p\.?\s*o\.?\s*box)\b|(?<!e-)\bmail(?:ed|ing)?\b/giu],
  ["courier", /\bcourier(?:ed|ing|s)?\b/giu],
  ["hand_delivery", /\b(?:hand delivery|hand-deliver(?:ed|y)?|in person)\b/giu]
];

const CHANNEL_ORDER: SubmissionChannelSignature[] = [
  "email", "portal", "electronic", "fax", "postal_mail", "courier", "hand_delivery"
];

const PROMPT_INJECTION_PATTERN =
  /\b(?:ignore|disregard|override|forget)\b.{0,80}\b(?:(?:prior|previous|earlier|above|all)\s+)?(?:instructions?|directions?|rules?|system|developer|prompt)\b|\bdo\s+not\s+(?:follow|obey)\b.{0,80}\b(?:instructions?|directions?|rules?|prompt)\b|\b(?:system|developer)\s+(?:message|prompt)\b|\b(?:browse|search)\s+(?:the\s+)?(?:web|internet)\b|\b(?:call|invoke|use)\s+(?:a\s+)?(?:tool|function)\b|\b(?:reveal|print|return|output)\b.{0,60}\b(?:hidden|system|developer)\s+(?:prompt|instructions?)\b/isu;

const SECTION_HEADING_PATTERN =
  /(?:submission of (?:bids?|proposals?|tenders?|offers?)|(?:bid|proposal|tender|offer) submission|delivery of (?:bids?|proposals?|tenders?|offers?)|return bids? to|submission (?:method|instructions?))/i;

function lexicalMentions(pageText: string): SubmissionOccurrence[] {
  const raw = CHANNEL_PATTERNS.flatMap(([channel, pattern]) => {
    pattern.lastIndex = 0;
    return [...pageText.matchAll(pattern)].flatMap((match) => match.index === undefined ? [] : [{
      channel_hint: channel,
      mention_start_utf16: match.index,
      mention_end_utf16: match.index + match[0].length
    }]);
  }).sort((left, right) => left.mention_start_utf16 - right.mention_start_utf16 ||
    left.mention_end_utf16 - right.mention_end_utf16 ||
    CHANNEL_ORDER.indexOf(left.channel_hint) - CHANNEL_ORDER.indexOf(right.channel_hint));

  // "electronic mail" and "electronic ... portal" are one specific channel
  // occurrence, not an independent generic-electronic delivery authority.
  const filtered = raw.filter((candidate) => candidate.channel_hint !== "electronic" ||
    !raw.some((specific) => specific.channel_hint !== "electronic" &&
      specific.mention_start_utf16 >= candidate.mention_start_utf16 &&
      specific.mention_start_utf16 - candidate.mention_end_utf16 <= 12));
  const unique = new Map<string, Omit<SubmissionOccurrence, "occurrence_id">>();
  for (const mention of filtered) {
    unique.set(`${mention.channel_hint}:${mention.mention_start_utf16}:${mention.mention_end_utf16}`, mention);
  }
  return [...unique.values()].map((mention) => ({
    ...mention,
    occurrence_id: "" // Bound to document/page below.
  }));
}

export function submissionChannelSignatures(value: string) {
  const present = new Set(lexicalMentions(value).map((mention) => mention.channel_hint));
  return new Set(CHANNEL_ORDER.filter((channel) => present.has(channel)));
}

export function submissionPromptInjectionDetected(value: string) {
  return PROMPT_INJECTION_PATTERN.test(value);
}

function stableAmendmentKey(value: string | null) {
  if (value === null) return "";
  const numeric = /^0*(\d+)$/.exec(value.trim());
  return numeric ? numeric[1].padStart(12, "0") : `~${value}`;
}

export type SubmissionCandidateDocument = CitationDocument & {
  role: "base" | "amendment";
  amendmentNumber: string | null;
};

function stableDocumentOrder(
  left: SubmissionCandidateDocument,
  right: SubmissionCandidateDocument
) {
  const role = (left.role === "base" ? 0 : 1) - (right.role === "base" ? 0 : 1);
  if (role !== 0) return role;
  const amendment = stableAmendmentKey(left.amendmentNumber)
    .localeCompare(stableAmendmentKey(right.amendmentNumber));
  if (amendment !== 0) return amendment;
  return left.index.documentSha256.localeCompare(right.index.documentSha256);
}

function pageWindows(length: number) {
  if (length === 0) return [{ start: 0, end: 0 }];
  const stride = SUBMISSION_WINDOW_UTF16 - SUBMISSION_WINDOW_OVERLAP_UTF16;
  const finalStart = Math.max(0, length - SUBMISSION_WINDOW_UTF16);
  const starts = [0];
  while (starts.at(-1)! < finalStart) {
    starts.push(Math.min(finalStart, starts.at(-1)! + stride));
  }
  return starts.map((start) => ({
    start,
    end: Math.min(length, start + SUBMISSION_WINDOW_UTF16)
  }));
}

function sectionAt(pageText: string, offset: number) {
  const nextLineBreak = pageText.indexOf("\n", offset);
  const throughCurrentLine = nextLineBreak < 0 ? pageText.length : nextLineBreak;
  const lines = pageText.slice(0, throughCurrentLine).split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (SECTION_HEADING_PATTERN.test(line)) {
      return /^(\d+(?:\.\d+)+)\b/.exec(line)?.[1] ?? (line.slice(0, 500) || null);
    }
  }
  return null;
}

function candidateIdentity(candidate: Omit<SubmissionCandidate, "candidate_id">) {
  return {
    ledger_version: SUBMISSION_LEDGER_VERSION,
    document_sha256: candidate.document_sha256,
    pdf_page_1based: candidate.pdf_page_1based,
    page_text_sha256: candidate.page_text_sha256,
    source_start_utf16: candidate.source_start_utf16,
    source_end_utf16: candidate.source_end_utf16,
    channel_hint: candidate.channel_hint,
    relation_capacity: candidate.relation_capacity,
    focus_occurrence_id: candidate.focus_occurrence?.occurrence_id ?? null,
    occurrences: candidate.occurrences.map((occurrence) => ({
      occurrence_id: occurrence.occurrence_id,
      channel_hint: occurrence.channel_hint,
      mention_start_utf16: occurrence.mention_start_utf16,
      mention_end_utf16: occurrence.mention_end_utf16
    }))
  };
}

function redactedLedgerIdentity(candidate: SubmissionCandidate) {
  return {
    candidate_id: candidate.candidate_id,
    document_sha256: candidate.document_sha256,
    role: candidate.role,
    amendment_number: candidate.amendment_number,
    pdf_page_1based: candidate.pdf_page_1based,
    printed_page_label: candidate.printed_page_label,
    page_text_sha256: candidate.page_text_sha256,
    section: candidate.section,
    source_start_utf16: candidate.source_start_utf16,
    source_end_utf16: candidate.source_end_utf16,
    channel_hint: candidate.channel_hint,
    relation_capacity: candidate.relation_capacity,
    focus_occurrence_id: candidate.focus_occurrence?.occurrence_id ?? null,
    occurrence_ids: candidate.occurrences.map((occurrence) => occurrence.occurrence_id)
  };
}

export function discoverSubmissionCandidateLedger(
  inputDocuments: SubmissionCandidateDocument[]
): SubmissionCandidateLedger {
  const documents = [...new Map(inputDocuments.slice().sort(stableDocumentOrder).map((document) => [
    `${document.role}:${document.amendmentNumber ?? ""}:${document.index.documentSha256}`,
    document
  ])).values()];
  const candidates: SubmissionCandidate[] = [];
  let expectedPageCount = 0;
  let coveredPageCount = 0;
  let pageMetadataComplete = true;
  let occurrenceCoverageComplete = true;

  for (const document of documents) {
    expectedPageCount += document.index.pagesTotal;
    const orderedPages = document.index.pages.slice().sort((left, right) =>
      left.pdfPage1Based - right.pdfPage1Based ||
      sha256Hex(left.text).localeCompare(sha256Hex(right.text))
    );
    const pageNumbers = orderedPages.map((page) => page.pdfPage1Based);
    if (orderedPages.length !== document.index.pagesTotal ||
      new Set(pageNumbers).size !== pageNumbers.length ||
      pageNumbers.some((pageNumber, index) => pageNumber !== index + 1)) {
      pageMetadataComplete = false;
    }
    const countedPages = new Set<number>();
    for (const page of orderedPages) {
      const pageTextSha256 = sha256Hex(page.text);
      const occurrences = lexicalMentions(page.text).map((occurrence) => ({
        ...occurrence,
        occurrence_id: sha256Hex(stableJson({
          ledger_version: SUBMISSION_LEDGER_VERSION,
          document_sha256: document.index.documentSha256,
          pdf_page_1based: page.pdfPage1Based,
          page_text_sha256: pageTextSha256,
          channel_hint: occurrence.channel_hint,
          mention_start_utf16: occurrence.mention_start_utf16,
          mention_end_utf16: occurrence.mention_end_utf16
        })).slice(0, 32)
      }));
      const windows = pageWindows(page.text.length);
      if (occurrences.some((occurrence) => !windows.some((window) =>
        occurrence.mention_start_utf16 >= window.start &&
        occurrence.mention_end_utf16 <= window.end
      ))) {
        occurrenceCoverageComplete = false;
      }
      if (!countedPages.has(page.pdfPage1Based) && page.pdfPage1Based >= 1 &&
        page.pdfPage1Based <= document.index.pagesTotal && windows.length > 0 &&
        windows[0]?.start === 0 && windows.at(-1)?.end === page.text.length) {
        coveredPageCount += 1;
        countedPages.add(page.pdfPage1Based);
      }
      for (const window of windows) {
        const visibleOccurrences = occurrences.filter((occurrence) =>
          occurrence.mention_start_utf16 >= window.start &&
          occurrence.mention_end_utf16 <= window.end
        );
        const provisional: Omit<SubmissionCandidate, "candidate_id"> = {
          document_sha256: document.index.documentSha256,
          role: document.role,
          amendment_number: document.amendmentNumber,
          pdf_page_1based: page.pdfPage1Based,
          printed_page_label: page.printedPageLabel,
          page_text_sha256: pageTextSha256,
          section: sectionAt(page.text, window.start),
          source_start_utf16: window.start,
          source_end_utf16: window.end,
          source_window: page.text.slice(window.start, window.end),
          channel_hint: visibleOccurrences.length === 1
            ? visibleOccurrences[0]!.channel_hint
            : "unspecified",
          relation_capacity: Math.min(
            MAX_SUBMISSION_RELATIONS_PER_UNIT,
            Math.max(1, visibleOccurrences.length)
          ),
          focus_occurrence: null,
          occurrences: visibleOccurrences
        };
        candidates.push({
          ...provisional,
          candidate_id: sha256Hex(stableJson(candidateIdentity(provisional))).slice(0, 32)
        });
      }
    }
  }

  const stableCandidates = [...new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]))
    .values()].sort((left, right) => {
      const role = (left.role === "base" ? 0 : 1) - (right.role === "base" ? 0 : 1);
      if (role !== 0) return role;
      const amendment = stableAmendmentKey(left.amendment_number)
        .localeCompare(stableAmendmentKey(right.amendment_number));
      if (amendment !== 0) return amendment;
      return left.document_sha256.localeCompare(right.document_sha256) ||
        left.pdf_page_1based - right.pdf_page_1based ||
        left.source_start_utf16 - right.source_start_utf16 ||
        (left.focus_occurrence?.mention_start_utf16 ?? -1) -
          (right.focus_occurrence?.mention_start_utf16 ?? -1) ||
        left.candidate_id.localeCompare(right.candidate_id);
    });
  const baseCount = documents.filter((document) => document.role === "base").length;
  const amendmentNumbers = documents.filter((document) => document.role === "amendment")
    .flatMap((document) => /^0*(\d+)$/.exec(document.amendmentNumber ?? "")?.[1] ?? [])
    .map((value) => Number.parseInt(value, 10))
    .sort((left, right) => left - right);
  const amendmentCount = documents.filter((document) => document.role === "amendment").length;
  const metadataComplete = pageMetadataComplete && baseCount === 1 && documents.every((document) =>
    document.role === "base" ? document.amendmentNumber === null : true
  ) && amendmentNumbers.length === amendmentCount &&
    new Set(amendmentNumbers).size === amendmentNumbers.length &&
    amendmentNumbers.every((number, index) => number === index + 1);
  const ledgerDigest = sha256Hex(stableJson({
    ledger_version: SUBMISSION_LEDGER_VERSION,
    expected_page_count: expectedPageCount,
    covered_page_count: coveredPageCount,
    metadata_complete: metadataComplete,
    candidates: stableCandidates.map(redactedLedgerIdentity)
  }));
  return {
    ledger_version: SUBMISSION_LEDGER_VERSION,
    ledger_digest: ledgerDigest,
    candidates: stableCandidates,
    expected_page_count: expectedPageCount,
    covered_page_count: coveredPageCount,
    metadata_complete: metadataComplete,
    capacity_exceeded: !occurrenceCoverageComplete ||
      stableCandidates.length > MAX_SUBMISSION_COVERAGE_UNITS ||
      stableCandidates.some((candidate) =>
        candidate.occurrences.length > MAX_SUBMISSION_RELATIONS_PER_UNIT
      )
  };
}

function uniqueReasons(values: SubmissionUnresolvedReason[]) {
  return [...new Set(values)];
}

function unresolvedArtifact(
  ledger: SubmissionCandidateLedger,
  reason: SubmissionUnresolvedReason,
  expectedSourceFragments: number,
  expectedBatches = 0
): VerifiedSubmissionAdjudication {
  return {
    ledger_version: SUBMISSION_LEDGER_VERSION,
    ledger_digest: ledger.ledger_digest,
    expected_candidate_count: ledger.candidates.length,
    verified_candidate_count: 0,
    expected_page_count: ledger.expected_page_count,
    covered_page_count: ledger.covered_page_count,
    expected_source_fragment_count: expectedSourceFragments,
    verified_source_fragment_count: 0,
    expected_batch_count: expectedBatches,
    verified_batch_count: 0,
    complete: false,
    unresolved_reasons: [reason],
    records: ledger.candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      document_sha256: candidate.document_sha256,
      pdf_page_1based: candidate.pdf_page_1based,
      page_text_sha256: candidate.page_text_sha256,
      disposition: "unresolved",
      reason,
      relations: []
    }))
  };
}

export function unresolvedSubmissionAdjudication(
  ledger: SubmissionCandidateLedger,
  reason: SubmissionUnresolvedReason = "capacity",
  expectedSourceFragments = 0
) {
  return unresolvedArtifact(ledger, reason, expectedSourceFragments);
}

function relationSignature(relation: RedactedSubmissionRelation) {
  return stableJson({
    subject_scope: relation.subject_scope,
    modality: relation.modality,
    channel: relation.channel,
    has_condition_or_scope: relation.has_condition_or_scope,
    condition_or_scope_sha256: relation.condition_or_scope_sha256
  });
}

function pageSlice(candidate: SubmissionCandidate, start: number, end: number) {
  if (start < candidate.source_start_utf16 || end > candidate.source_end_utf16 || end <= start) {
    return null;
  }
  return candidate.source_window.slice(
    start - candidate.source_start_utf16,
    end - candidate.source_start_utf16
  );
}

function validateRelation(
  candidate: SubmissionCandidate,
  decision: SubmissionRelationDecision
): { relation: RedactedSubmissionRelation | null; reason: SubmissionUnresolvedReason | null } {
  const quote = pageSlice(candidate, decision.relation_start_utf16, decision.relation_end_utf16);
  if (quote === null || quote.length === 0) return { relation: null, reason: "offset_mismatch" };
  if (quote.length > MAX_SUBMISSION_QUOTE_UTF16) return { relation: null, reason: "quote_too_long" };
  if (decision.confidence < MIN_SUBMISSION_CONFIDENCE) return { relation: null, reason: "low_confidence" };
  const bothConditionOffsetsNull = decision.condition_start_utf16 === null &&
    decision.condition_end_utf16 === null;
  const boundedCondition = decision.condition_start_utf16 !== null &&
    decision.condition_end_utf16 !== null
    ? pageSlice(candidate, decision.condition_start_utf16, decision.condition_end_utf16)
    : null;
  if ((!bothConditionOffsetsNull && boundedCondition === null) ||
    (boundedCondition !== null && boundedCondition.length === 0)) {
    return { relation: null, reason: "condition_mismatch" };
  }
  if (decision.condition_start_utf16 !== null && decision.condition_end_utf16 !== null &&
    (decision.condition_start_utf16 < decision.relation_start_utf16 ||
      decision.condition_end_utf16 > decision.relation_end_utf16)) {
    return { relation: null, reason: "condition_mismatch" };
  }
  // Channel lexemes are discovery hints only. The same-call Agent adjudicates
  // the semantics of every complete page window, including unfamiliar product
  // names that map to a bounded channel enum. Exact offsets still bind the
  // decision to PDF.js source text; a dictionary match is not authority.
  if (decision.subject_scope === "ambiguous" || decision.modality === "unknown" ||
    (decision.subject_scope === "whole_bid" && decision.channel === "unspecified")) {
    return { relation: null, reason: "semantic_uncertainty" };
  }
  const occurrenceKey = sha256Hex(stableJson({
    ledger_version: SUBMISSION_LEDGER_VERSION,
    document_sha256: candidate.document_sha256,
    pdf_page_1based: candidate.pdf_page_1based,
    page_text_sha256: candidate.page_text_sha256,
    relation_start_utf16: decision.relation_start_utf16,
    relation_end_utf16: decision.relation_end_utf16,
    channel: decision.channel
  })).slice(0, 32);
  return {
    relation: {
      occurrence_key: occurrenceKey,
      document_sha256: candidate.document_sha256,
      role: candidate.role,
      amendment_number: candidate.amendment_number,
      pdf_page_1based: candidate.pdf_page_1based,
      printed_page_label: candidate.printed_page_label,
      page_text_sha256: candidate.page_text_sha256,
      section: sectionAt(
        candidate.source_window,
        decision.relation_start_utf16 - candidate.source_start_utf16
      ) ?? candidate.section,
      relation_start_utf16: decision.relation_start_utf16,
      relation_end_utf16: decision.relation_end_utf16,
      subject_scope: decision.subject_scope,
      modality: decision.modality,
      channel: decision.channel,
      has_condition_or_scope: boundedCondition !== null,
      condition_or_scope_sha256: boundedCondition === null ? null : sha256Hex(boundedCondition),
      confidence: decision.confidence,
      evidence_quote: decision.subject_scope === "whole_bid" ? quote : null,
      evidence_quote_sha256: sha256Hex(quote)
    },
    reason: null
  };
}

export function verifySubmissionAdjudication(input: {
  ledger: SubmissionCandidateLedger;
  bindings: SubmissionBatchBinding[];
  responses: SubmissionBatchAdjudication[];
  packingComplete: boolean;
}): VerifiedSubmissionAdjudication {
  const expectedSourceFragments = input.bindings.reduce(
    (count, binding) => count + binding.ordered_source_fragment_ids.length,
    0
  );
  if (input.ledger.capacity_exceeded || !input.packingComplete) {
    return unresolvedArtifact(input.ledger, "capacity", expectedSourceFragments, input.bindings.length);
  }
  if (input.ledger.expected_page_count !== input.ledger.covered_page_count) {
    return unresolvedArtifact(input.ledger, "incomplete_page_coverage", expectedSourceFragments,
      input.bindings.length);
  }
  if (!input.ledger.metadata_complete) {
    return unresolvedArtifact(input.ledger, "invalid_amendment_metadata", expectedSourceFragments,
      input.bindings.length);
  }
  const knownCandidateIds = new Set(input.ledger.candidates.map((candidate) => candidate.candidate_id));
  const bindingAssignmentCounts = new Map<string, number>();
  let unknownBoundCandidate = false;
  for (const candidateId of input.bindings.flatMap((binding) => binding.ordered_candidate_ids)) {
    if (!knownCandidateIds.has(candidateId)) {
      unknownBoundCandidate = true;
      continue;
    }
    bindingAssignmentCounts.set(candidateId, (bindingAssignmentCounts.get(candidateId) ?? 0) + 1);
  }
  if (unknownBoundCandidate) {
    return unresolvedArtifact(input.ledger, "unknown_candidate", expectedSourceFragments,
      input.bindings.length);
  }
  if (input.ledger.candidates.some((candidate) =>
    (bindingAssignmentCounts.get(candidate.candidate_id) ?? 0) > 1
  )) {
    return unresolvedArtifact(input.ledger, "duplicate_candidate", expectedSourceFragments,
      input.bindings.length);
  }
  if (input.ledger.candidates.some((candidate) =>
    (bindingAssignmentCounts.get(candidate.candidate_id) ?? 0) === 0
  )) {
    return unresolvedArtifact(input.ledger, "missing_candidate", expectedSourceFragments,
      input.bindings.length);
  }

  const responseByBatch = new Map<string, SubmissionBatchAdjudication[]>();
  for (const response of input.responses) {
    responseByBatch.set(response.batch_id, [...(responseByBatch.get(response.batch_id) ?? []), response]);
  }
  const expectedBatchIds = new Set(input.bindings.map((binding) => binding.batch_id));
  const hasUnknownBatch = [...responseByBatch].some(([batchId]) => !expectedBatchIds.has(batchId));
  const records = new Map<string, VerifiedSubmissionRecord>();
  const globalReasons: SubmissionUnresolvedReason[] = hasUnknownBatch ? ["unknown_batch"] : [];
  let verifiedSourceFragments = 0;
  const transportVerifiedBatchIds = new Set<string>();

  for (const binding of input.bindings) {
    const candidates = binding.ordered_candidate_ids.map((id) =>
      input.ledger.candidates.find((candidate) => candidate.candidate_id === id)
    ).filter((candidate): candidate is SubmissionCandidate => Boolean(candidate));
    const responses = responseByBatch.get(binding.batch_id) ?? [];
    let batchReason: SubmissionUnresolvedReason | null = null;
    if (responses.length === 0) batchReason = "missing_batch";
    else if (responses.length > 1) batchReason = "duplicate_batch";
    const response = responses[0];
    if (!batchReason && response.ledger_digest !== binding.ledger_digest) {
      batchReason = "ledger_digest_mismatch";
    }
    if (!batchReason && (!response ||
      stableJson(response.ordered_candidate_ids) !== stableJson(binding.ordered_candidate_ids) ||
      stableJson(response.ordered_source_fragment_ids) !== stableJson(binding.ordered_source_fragment_ids))) {
      batchReason = "batch_manifest_mismatch";
    }
    if (!batchReason && binding.prompt_injection_tainted) batchReason = "prompt_injection";
    if (batchReason) {
      for (const candidate of candidates) {
        records.set(candidate.candidate_id, {
          candidate_id: candidate.candidate_id,
          document_sha256: candidate.document_sha256,
          pdf_page_1based: candidate.pdf_page_1based,
          page_text_sha256: candidate.page_text_sha256,
          disposition: "unresolved",
          reason: batchReason,
          relations: []
        });
      }
      globalReasons.push(batchReason);
      continue;
    }
    verifiedSourceFragments += binding.ordered_source_fragment_ids.length;
    transportVerifiedBatchIds.add(binding.batch_id);
    const decisionsByCandidate = new Map<string, SubmissionCoverageDecision[]>();
    for (const coverage of response.coverage_units) {
      decisionsByCandidate.set(
        coverage.candidate_id,
        [...(decisionsByCandidate.get(coverage.candidate_id) ?? []), coverage]
      );
    }
    const expectedCandidateIds = new Set(binding.ordered_candidate_ids);
    const unknownCandidate = [...decisionsByCandidate].some(([id]) => !expectedCandidateIds.has(id));
    if (unknownCandidate) globalReasons.push("unknown_candidate");

    for (const candidate of candidates) {
      let reason: SubmissionUnresolvedReason | null = unknownCandidate ? "unknown_candidate" : null;
      const decisions = decisionsByCandidate.get(candidate.candidate_id) ?? [];
      if (!reason && decisions.length === 0) reason = "missing_candidate";
      if (!reason && decisions.length > 1) reason = "duplicate_candidate";
      const coverage = decisions[0];
      if (!reason && coverage.document_sha256 !== candidate.document_sha256) reason = "sha_mismatch";
      if (!reason && coverage.pdf_page_1based !== candidate.pdf_page_1based) reason = "page_mismatch";
      const relations: RedactedSubmissionRelation[] = [];
      if (!reason) {
        if (coverage.relations.length > candidate.relation_capacity) reason = "capacity";
      }
      if (!reason) {
        for (const decision of coverage.relations) {
          const validated = validateRelation(candidate, decision);
          if (validated.reason) {
            reason = validated.reason;
            break;
          }
          relations.push(validated.relation!);
        }
      }
      records.set(candidate.candidate_id, {
        candidate_id: candidate.candidate_id,
        document_sha256: candidate.document_sha256,
        pdf_page_1based: candidate.pdf_page_1based,
        page_text_sha256: candidate.page_text_sha256,
        disposition: reason ? "unresolved" : "verified",
        reason,
        relations: reason ? [] : relations
      });
      if (reason) globalReasons.push(reason);
    }
  }

  for (const candidate of input.ledger.candidates) {
    if (records.has(candidate.candidate_id)) continue;
    records.set(candidate.candidate_id, {
      candidate_id: candidate.candidate_id,
      document_sha256: candidate.document_sha256,
      pdf_page_1based: candidate.pdf_page_1based,
      page_text_sha256: candidate.page_text_sha256,
      disposition: "unresolved",
      reason: "missing_candidate",
      relations: []
    });
    globalReasons.push("missing_candidate");
  }

  // Every exact relation that falls wholly inside more than one overlapping
  // all-page window must be emitted exactly once and identically by each such
  // window. This check does not depend on a channel dictionary, so unfamiliar
  // names receive the same consistency proof as lexically discovered hints.
  const checkedRelationSpans = new Set<string>();
  for (const relation of [...records.values()].flatMap((record) => record.relations)) {
    const spanKey = stableJson({
      document_sha256: relation.document_sha256,
      pdf_page_1based: relation.pdf_page_1based,
      relation_start_utf16: relation.relation_start_utf16,
      relation_end_utf16: relation.relation_end_utf16
    });
    if (checkedRelationSpans.has(spanKey)) continue;
    checkedRelationSpans.add(spanKey);
    const enclosingCandidates = input.ledger.candidates.filter((candidate) =>
      candidate.document_sha256 === relation.document_sha256 &&
      candidate.pdf_page_1based === relation.pdf_page_1based &&
      candidate.source_start_utf16 <= relation.relation_start_utf16 &&
      candidate.source_end_utf16 >= relation.relation_end_utf16
    );
    const matches = enclosingCandidates.map((candidate) =>
      records.get(candidate.candidate_id)?.relations.filter((candidateRelation) =>
        candidateRelation.relation_start_utf16 === relation.relation_start_utf16 &&
        candidateRelation.relation_end_utf16 === relation.relation_end_utf16
      ) ?? []
    );
    const signatureSets = matches.map((values) => stableJson(
      [...new Set(values.map(relationSignature))].toSorted()
    ));
    if (matches.every((values) => values.length > 0) &&
      new Set(signatureSets).size === 1) continue;
    globalReasons.push("overlap_disagreement");
    for (const candidate of enclosingCandidates) {
      const record = records.get(candidate.candidate_id);
      if (!record) continue;
      record.disposition = "unresolved";
      record.reason = "overlap_disagreement";
      record.relations = [];
    }
  }

  const orderedRecords = input.ledger.candidates.map((candidate) => records.get(candidate.candidate_id)!);
  const verifiedCount = orderedRecords.filter((record) => record.disposition === "verified").length;
  const verifiedBatchCount = input.bindings.filter((binding) =>
    transportVerifiedBatchIds.has(binding.batch_id) && binding.ordered_candidate_ids.every((id) =>
      records.get(id)?.disposition === "verified"
    )
  ).length;
  const unresolvedReasons = uniqueReasons([
    ...globalReasons,
    ...orderedRecords.flatMap((record) => record.reason ? [record.reason] : [])
  ]);
  return {
    ledger_version: SUBMISSION_LEDGER_VERSION,
    ledger_digest: input.ledger.ledger_digest,
    expected_candidate_count: input.ledger.candidates.length,
    verified_candidate_count: verifiedCount,
    expected_page_count: input.ledger.expected_page_count,
    covered_page_count: input.ledger.covered_page_count,
    expected_source_fragment_count: expectedSourceFragments,
    verified_source_fragment_count: verifiedSourceFragments,
    expected_batch_count: input.bindings.length,
    verified_batch_count: verifiedBatchCount,
    complete: input.ledger.candidates.length > 0 && unresolvedReasons.length === 0 &&
      verifiedCount === input.ledger.candidates.length &&
      verifiedSourceFragments === expectedSourceFragments,
    unresolved_reasons: unresolvedReasons,
    records: orderedRecords
  };
}

export function resolveVerifiedSubmissionChannel(
  artifact: VerifiedSubmissionAdjudication | null | undefined,
  options: {
    draftChannels?: Iterable<SubmissionChannelSignature>;
    amendmentMutationSignal?: boolean;
    packageMetadataComplete?: boolean;
    unboundEvidenceSignal?: boolean;
  } = {}
): SubmissionChannelResolution {
  if (!artifact || !artifact.complete || artifact.unresolved_reasons.length > 0 ||
    options.packageMetadataComplete === false ||
    options.unboundEvidenceSignal === true ||
    artifact.verified_candidate_count !== artifact.expected_candidate_count ||
    artifact.verified_source_fragment_count !== artifact.expected_source_fragment_count) {
    return { status: "unresolved", channel: null, decisive: null };
  }
  if (options.amendmentMutationSignal) {
    return { status: "unresolved", channel: null, decisive: null };
  }
  const relations = artifact.records.flatMap((record) => record.relations);
  if (relations.some((relation) => relation.subject_scope === "ambiguous" ||
    relation.modality === "unknown" || (relation.subject_scope === "whole_bid" &&
      relation.channel === "unspecified"))) {
    return { status: "unresolved", channel: null, decisive: null };
  }
  const wholeBid = relations.filter((relation) => relation.subject_scope === "whole_bid");
  const amendmentWholeBid = wholeBid.filter((relation) => relation.role === "amendment");
  if (amendmentWholeBid.length > 0) {
    const positiveSignature = (relation: RedactedSubmissionRelation) => stableJson({
      channel: relation.channel,
      modality: relation.modality,
      has_condition_or_scope: relation.has_condition_or_scope,
      condition_or_scope_sha256: relation.condition_or_scope_sha256
    });
    const basePositive = new Set(wholeBid.filter((relation) =>
      relation.role === "base" && relation.modality !== "prohibited"
    ).map(positiveSignature));
    const amendmentVersions = new Map<string, RedactedSubmissionRelation[]>();
    for (const relation of amendmentWholeBid) {
      if (relation.modality === "prohibited") continue;
      const version = relation.amendment_number ?? "";
      amendmentVersions.set(version, [...(amendmentVersions.get(version) ?? []), relation]);
    }
    for (const versionRelations of amendmentVersions.values()) {
      const versionPositive = new Set(versionRelations.map(positiveSignature));
      if (basePositive.size !== versionPositive.size ||
        [...basePositive].some((signature) => !versionPositive.has(signature)) ||
        !versionRelations.some((relation) => relation.modality === "required")) {
        return { status: "unresolved", channel: null, decisive: null };
      }
    }
  }
  const possible = new Set(wholeBid.filter((relation) =>
    relation.channel !== "unspecified" && relation.modality !== "prohibited"
  ).map((relation) => relation.channel as SubmissionChannelSignature));
  const required = wholeBid.filter((relation) => relation.channel !== "unspecified" &&
    relation.modality === "required");
  const prohibited = new Set(wholeBid.filter((relation) => relation.channel !== "unspecified" &&
    relation.modality === "prohibited" && !relation.has_condition_or_scope
  ).map((relation) => relation.channel as SubmissionChannelSignature));
  const draftChannels = new Set(options.draftChannels ?? []);
  if (draftChannels.size > 0 && (possible.size !== 1 || draftChannels.size !== 1 ||
    !draftChannels.has([...possible][0]!))) {
    return { status: "unresolved", channel: null, decisive: null };
  }
  if (possible.size === 0) return { status: "none", channel: null, decisive: null };
  if (possible.size > 1) return { status: "multiple", channel: null, decisive: null };
  const channel = [...possible][0]!;
  if (prohibited.has(channel)) return { status: "contradicted", channel: null, decisive: null };
  const decisive = required.find((relation) => relation.channel === channel);
  if (!decisive) return { status: "possible_only", channel: null, decisive: null };
  return { status: "unique", channel, decisive };
}

export function scrubSubmissionCandidateLedger(ledger: SubmissionCandidateLedger | undefined) {
  if (!ledger) return;
  for (const candidate of ledger.candidates) {
    candidate.source_window = "";
    candidate.occurrences = [];
    candidate.focus_occurrence = null;
  }
}
