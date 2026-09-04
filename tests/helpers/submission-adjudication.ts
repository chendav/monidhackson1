import {
  discoverSubmissionCandidateLedger,
  SubmissionBatchAdjudicationSchema,
  verifySubmissionAdjudication,
  type SubmissionCandidate,
  type SubmissionCandidateDocument,
  type SubmissionChannelHint,
  type SubmissionRelationDecision,
  type VerifiedSubmissionAdjudication
} from "@/lib/analysis/submission-channel";
import { sha256Hex, stableJson } from "@/lib/crypto";

export interface FixtureSubmissionRelation {
  evidenceText?: string;
  subjectScope: SubmissionRelationDecision["subject_scope"];
  modality: SubmissionRelationDecision["modality"];
  channel?: SubmissionChannelHint;
  conditionText?: string | null;
  confidence?: number;
}

export type FixtureSubmissionDecider = (
  candidate: SubmissionCandidate
) => FixtureSubmissionRelation[] | undefined;

function matchingSpan(candidate: SubmissionCandidate, text: string) {
  const matches: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor <= candidate.source_window.length) {
    const localStart = candidate.source_window.indexOf(text, cursor);
    if (localStart < 0) break;
    const start = candidate.source_start_utf16 + localStart;
    const end = start + text.length;
    matches.push({ start, end });
    cursor = localStart + Math.max(1, text.length);
  }
  return matches[0] ?? null;
}

function fixtureDecision(
  candidate: SubmissionCandidate,
  relation: FixtureSubmissionRelation
): SubmissionRelationDecision {
  const evidenceText = relation.evidenceText ?? "";
  const evidence = matchingSpan(candidate, evidenceText);
  if (!evidence) throw new Error(`Fixture evidence not found for ${candidate.candidate_id}: ${evidenceText}`);
  const condition = relation.conditionText
    ? matchingSpan(candidate, relation.conditionText)
    : null;
  if (relation.conditionText && !condition) {
    throw new Error(`Fixture condition not found for ${candidate.candidate_id}: ${relation.conditionText}`);
  }
  return {
    relation_start_utf16: evidence.start,
    relation_end_utf16: evidence.end,
    subject_scope: relation.subjectScope,
    modality: relation.modality,
    channel: relation.channel ?? candidate.channel_hint,
    condition_start_utf16: condition?.start ?? null,
    condition_end_utf16: condition?.end ?? null,
    confidence: relation.confidence ?? 0.99
  };
}

/**
 * Builds a fully server-verified private artifact from explicit fixture
 * decisions. This helper deliberately has no English semantic classifier.
 * Unmentioned focused occurrences are explicitly classified as `other` by the
 * fixture Agent, while ordinary full-page coverage units return no relation.
 */
export function verifiedFixtureSubmissionAdjudication(
  documents: SubmissionCandidateDocument[],
  decide: FixtureSubmissionDecider,
  options: { defaultOccurrenceDisposition?: "other" } = {}
): VerifiedSubmissionAdjudication {
  const ledger = discoverSubmissionCandidateLedger(documents);
  if (ledger.capacity_exceeded) {
    throw new Error(`Fixture ledger exceeds capacity with ${ledger.candidates.length} units.`);
  }
  const orderedCandidateIds = ledger.candidates.map((candidate) => candidate.candidate_id);
  const orderedSourceFragmentIds = documents.map((document) =>
    `fixture-${document.index.documentSha256}`
  );
  const batchId = sha256Hex(stableJson({
    fixture: "submission-adjudication",
    ledger_digest: ledger.ledger_digest,
    ordered_candidate_ids: orderedCandidateIds,
    ordered_source_fragment_ids: orderedSourceFragmentIds
  }));
  const coverageUnits = ledger.candidates.map((candidate) => {
    const explicit = decide(candidate);
    if (explicit?.some((relation) => relation.subjectScope === "whole_bid" &&
      !relation.evidenceText)) {
      throw new Error(`Whole-bid fixture relation requires exact clause text: ${candidate.candidate_id}`);
    }
    const explicitDecisions = (explicit ?? []).map((relation) => fixtureDecision(candidate, relation));
    const uncovered = candidate.occurrences.filter((occurrence) =>
      !explicitDecisions.some((relation) => relation.channel === occurrence.channel_hint &&
        relation.relation_start_utf16 <= occurrence.mention_start_utf16 &&
        relation.relation_end_utf16 >= occurrence.mention_end_utf16)
    );
    if (uncovered.length > 0 && options.defaultOccurrenceDisposition !== "other") {
      throw new Error(`Fixture occurrence was not adjudicated: ${candidate.candidate_id}`);
    }
    const fallback = uncovered.map((occurrence): SubmissionRelationDecision => ({
      relation_start_utf16: occurrence.mention_start_utf16,
      relation_end_utf16: occurrence.mention_end_utf16,
      subject_scope: "other",
      modality: "permitted",
      channel: occurrence.channel_hint,
      condition_start_utf16: null,
      condition_end_utf16: null,
      confidence: 0.99
    }));
    return {
      candidate_id: candidate.candidate_id,
      document_sha256: candidate.document_sha256,
      pdf_page_1based: candidate.pdf_page_1based,
      relations: [...explicitDecisions, ...fallback]
    };
  });
  const response = SubmissionBatchAdjudicationSchema.parse({
    batch_id: batchId,
    ledger_digest: ledger.ledger_digest,
    ordered_candidate_ids: orderedCandidateIds,
    ordered_source_fragment_ids: orderedSourceFragmentIds,
    coverage_units: coverageUnits
  });
  return verifySubmissionAdjudication({
    ledger,
    packingComplete: true,
    bindings: [{
      batch_id: batchId,
      ledger_digest: ledger.ledger_digest,
      ordered_candidate_ids: orderedCandidateIds,
      ordered_source_fragment_ids: orderedSourceFragmentIds,
      prompt_injection_tainted: false
    }],
    responses: [response]
  });
}
