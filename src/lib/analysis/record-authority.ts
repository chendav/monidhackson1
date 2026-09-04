import { z } from "zod";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import type {
  SubmissionBatchBinding,
  SubmissionCandidateLedger,
  SubmissionChannelSignature,
  VerifiedSubmissionAdjudication
} from "@/lib/analysis/submission-channel";
import { sha256Hex, stableJson } from "@/lib/crypto";
import type { CitationDocument } from "@/lib/evidence/citations";

export const RECORD_AUTHORITY_ENVELOPE_VERSION = 2 as const;
export const RECORD_AUTHORITY_VERSION = 3 as const;
export const RECORD_SOURCE_ALIGNMENT_VERSION = "issued-origin-pdfjs-selector-utf16-v4" as const;
// T10 carries relevance inline on every private model record. This bound is the
// sum of the strict private Draft collection maxima and is a server-only guard;
// it is no longer a positional provider sidecar or a 40-record delivery limit.
export const MAX_RECORD_AUTHORITY_RECORDS_PER_BATCH = 2_600;
export const MAX_MODEL_CITATIONS_PER_ANNOTATED_RECORD = 3;
export const MAX_EXACT_OCCURRENCES_PER_CITATION = 8;
export const MAX_RECORD_AUTHORITY_RECEIPT_BYTES = 262_144;

const RecordAuthorityPhysicalBindingSchema = z.object({
  citation_ordinal: z.number().int().nonnegative().max(MAX_MODEL_CITATIONS_PER_ANNOTATED_RECORD - 1),
  source_fragment_id: z.string().min(1).max(64),
  source_representation_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  selector_start_utf16: z.number().int().nonnegative(),
  selector_end_utf16: z.number().int().positive(),
  document_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pdf_page_1based: z.number().int().positive(),
  page_text_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  evidence_start_utf16: z.number().int().nonnegative(),
  evidence_end_utf16: z.number().int().positive(),
  evidence_quote_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  alignment_version: z.literal(RECORD_SOURCE_ALIGNMENT_VERSION)
}).strict();

const RecordAuthorityLegacyEnvelopeSchema = z.object({
  v: z.literal(1),
  r: z.array(z.tuple([
    z.enum(["c", "q", "r", "e"]),
    z.number().int().nonnegative(),
    z.enum(["s", "n", "u"])
  ])).max(MAX_RECORD_AUTHORITY_RECORDS_PER_BATCH)
}).strict();

const RecordAuthorityBoundEnvelopeSchema = z.object({
  v: z.literal(RECORD_AUTHORITY_ENVELOPE_VERSION),
  r: z.array(z.tuple([
    z.enum(["c", "q", "r", "e"]),
    z.number().int().nonnegative(),
    z.enum(["s", "n", "u"]),
    z.array(RecordAuthorityPhysicalBindingSchema).max(MAX_MODEL_CITATIONS_PER_ANNOTATED_RECORD)
  ])).max(MAX_RECORD_AUTHORITY_RECORDS_PER_BATCH)
}).strict();

export const RecordAuthorityEnvelopeSchema = z.discriminatedUnion("v", [
  RecordAuthorityLegacyEnvelopeSchema,
  RecordAuthorityBoundEnvelopeSchema
]);

export type RecordKind = "c" | "q" | "r" | "e";
export type SubmissionRelevance = "s" | "n" | "u";
export type RecordSourceBinding =
  | "unlocated"
  | "exact_bound"
  | "coverage_gap"
  | "relation_gap"
  | "relation_conflict";
export type RecordSemanticCrosscheck = "consistent" | "disagrees" | "unknown";
export type RecordPublication = "verified" | "discarded";
export type RecordPresentationField =
  | "claim_text"
  | "requirement_text"
  | "requirement_evidence_needed"
  | "requirement_consequence"
  | "risk_finding"
  | "risk_impact"
  | "risk_recommended_action"
  | "evaluation_value";
export type RecordAuthorityEnvelope = z.infer<typeof RecordAuthorityEnvelopeSchema>;
export type RecordAuthorityPhysicalBinding = z.infer<typeof RecordAuthorityPhysicalBindingSchema>;

export interface SemanticSpanSelector {
  source_fragment_id: string;
  start_utf16: number;
  length_utf16: number;
}

export interface ExactSourceQuoteSelector {
  source_fragment_id: string;
  exact_quote: string;
}

export type SourceMapOrigin = { kind: "source_fragment" } | {
  kind: "submission_coverage";
  candidate_id: string;
  pdf_page_1based: number;
  page_text_sha256: string;
  source_start_utf16: number;
  source_end_utf16: number;
  source_text_sha256: string;
};

export interface SourceMapFragment {
  source_fragment_id: string;
  document_sha256: string;
  chunk_id: string | null;
  text: string;
  origin?: SourceMapOrigin;
}

interface AlignmentUnit {
  value: string;
  rawStart: number;
  rawEnd: number;
  pdfPage1Based: number | null;
}

export interface AlignedSourceFragment {
  source_fragment_id: string;
  document_sha256: string;
  chunk_id: string | null;
  source_text: string;
  source_text_length: number;
  source_representation_sha256: string;
  source_units: AlignmentUnit[];
  origin: SourceMapOrigin;
}

export interface DocumentSourceMap {
  alignment_version: typeof RECORD_SOURCE_ALIGNMENT_VERSION;
  fragments: Map<string, AlignedSourceFragment>;
  pages_by_document: Map<string, Array<{
    pdfPage1Based: number;
    text: string;
    units: AlignmentUnit[];
  }>>;
}

function isWellFormedUtf16(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

interface WhitespaceAlignedUnit {
  value: string;
  whitespace: boolean;
  rawStart: number;
  rawEnd: number;
}

function whitespaceAlignedUnits(value: string) {
  const units: WhitespaceAlignedUnit[] = [];
  for (let cursor = 0; cursor < value.length;) {
    const whitespace = /\p{White_Space}/u.test(value[cursor]!);
    const start = cursor;
    if (whitespace) {
      while (cursor < value.length && /\p{White_Space}/u.test(value[cursor]!)) cursor += 1;
      units.push({ value: "<ws>", whitespace: true, rawStart: start, rawEnd: cursor });
    } else {
      units.push({ value: value[cursor]!, whitespace: false, rawStart: cursor, rawEnd: cursor + 1 });
      cursor += 1;
    }
  }
  return units;
}

function quoteSelectorsForFragment(fragment: AlignedSourceFragment, quote: string) {
  const quoteUnits = whitespaceAlignedUnits(quote);
  if (quoteUnits.length === 0 || quoteUnits[0]!.whitespace || quoteUnits.at(-1)!.whitespace) {
    return null;
  }
  const sourceUnits = whitespaceAlignedUnits(fragment.source_text);
  const selectors: SemanticSpanSelector[] = [];
  for (let start = 0; start <= sourceUnits.length - quoteUnits.length; start += 1) {
    if (!quoteUnits.every((unit, offset) => {
      const source = sourceUnits[start + offset]!;
      return unit.whitespace === source.whitespace && unit.value === source.value;
    })) continue;
    const first = sourceUnits[start]!;
    const last = sourceUnits[start + quoteUnits.length - 1]!;
    const rawLength = last.rawEnd - first.rawStart;
    if (rawLength < 1 || rawLength > 500 || !isWellFormedUtf16(
      fragment.source_text.slice(first.rawStart, last.rawEnd)
    )) return null;
    selectors.push({
      source_fragment_id: fragment.source_fragment_id,
      start_utf16: first.rawStart,
      length_utf16: rawLength
    });
  }
  return selectors;
}

/**
 * Convert a model-copied source quote into server-owned UTF-16 coordinates.
 * Only nonempty Unicode whitespace runs are representation-equivalent. Every
 * non-whitespace UTF-16 unit remains exact and ordered; no quote is repaired.
 */
export function positionUniqueExactSourceQuote(
  sourceMap: DocumentSourceMap,
  selector: ExactSourceQuoteSelector
): SemanticSpanSelector | null {
  const quote = selector.exact_quote;
  if (quote.length < 1 || quote.length > 500 || !isWellFormedUtf16(quote)) {
    return null;
  }
  const fragment = sourceMap.fragments.get(selector.source_fragment_id);
  if (!fragment) return null;
  const matches = quoteSelectorsForFragment(fragment, quote);
  return matches?.length === 1 ? matches[0]! : null;
}

export interface ResolvedSemanticSpan {
  document_sha256: string;
  chunk_id: string | null;
  evidence_quote: string;
  binding: Omit<RecordAuthorityPhysicalBinding, "citation_ordinal">;
}

function physicalBindingKey(resolved: ResolvedSemanticSpan) {
  const binding = resolved.binding;
  return stableJson({
    document_sha256: binding.document_sha256,
    pdf_page_1based: binding.pdf_page_1based,
    page_text_sha256: binding.page_text_sha256,
    evidence_start_utf16: binding.evidence_start_utf16,
    evidence_end_utf16: binding.evidence_end_utf16,
    evidence_quote_sha256: binding.evidence_quote_sha256
  });
}

function sourceOriginIntegrity(sourceMap: DocumentSourceMap, fragment: AlignedSourceFragment) {
  if (fragment.origin.kind === "source_fragment") return true;
  const origin = fragment.origin;
  const page = (sourceMap.pages_by_document.get(fragment.document_sha256) ?? []).find((item) =>
    item.pdfPage1Based === origin.pdf_page_1based
  );
  return Boolean(page && origin.candidate_id && origin.source_start_utf16 >= 0 &&
    origin.source_end_utf16 > origin.source_start_utf16 &&
    origin.source_end_utf16 <= page!.text.length &&
    origin.source_end_utf16 - origin.source_start_utf16 === fragment.source_text_length &&
    origin.page_text_sha256 === sha256Hex(page!.text) &&
    origin.source_text_sha256 === fragment.source_representation_sha256 &&
    page!.text.slice(origin.source_start_utf16, origin.source_end_utf16) === fragment.source_text);
}

function sourceOriginCommitted(
  batch: RecordAuthorityBatch,
  ledger: SubmissionCandidateLedger,
  fragment: AlignedSourceFragment
) {
  if (!batch.sourceMap || !sourceOriginIntegrity(batch.sourceMap, fragment)) return false;
  if (fragment.origin.kind === "source_fragment") {
    return batch.binding.ordered_source_fragment_ids.includes(fragment.source_fragment_id);
  }
  const origin = fragment.origin;
  const candidate = ledger.candidates.find((item) => item.candidate_id === origin.candidate_id);
  return Boolean(candidate && batch.binding.ordered_candidate_ids.includes(origin.candidate_id) &&
    candidate.document_sha256 === fragment.document_sha256 &&
    candidate.pdf_page_1based === origin.pdf_page_1based &&
    candidate.page_text_sha256 === origin.page_text_sha256 &&
    candidate.source_start_utf16 === origin.source_start_utf16 &&
    candidate.source_end_utf16 === origin.source_end_utf16 &&
    sha256Hex(candidate.source_window) === origin.source_text_sha256);
}

/** Resolve a quote against every evidence representation issued in one batch. */
export function resolveUniqueIssuedSourceQuote(
  sourceMap: DocumentSourceMap,
  selector: { document_sha256: string; exact_quote: string },
  documents: CitationDocument[]
): ResolvedSemanticSpan | null {
  const quote = selector.exact_quote;
  if (quote.length < 1 || quote.length > 500 || !isWellFormedUtf16(quote)) return null;
  const resolved: ResolvedSemanticSpan[] = [];
  for (const fragment of sourceMap.fragments.values()) {
    if (fragment.document_sha256 !== selector.document_sha256) continue;
    if (!sourceOriginIntegrity(sourceMap, fragment)) return null;
    const positionedMatches = quoteSelectorsForFragment(fragment, quote);
    if (positionedMatches === null) return null;
    for (const positioned of positionedMatches) {
      const match = resolveSemanticSpan(sourceMap, positioned, documents);
      // Every representation occurrence must have a physical explanation.
      if (!match || match.document_sha256 !== selector.document_sha256) return null;
      resolved.push(match);
    }
  }
  const byPhysicalSpan = new Map<string, ResolvedSemanticSpan>();
  for (const match of resolved.toSorted((left, right) =>
    left.binding.source_fragment_id.localeCompare(right.binding.source_fragment_id))) {
    byPhysicalSpan.set(physicalBindingKey(match), match);
  }
  return byPhysicalSpan.size === 1 ? [...byPhysicalSpan.values()][0]! : null;
}

export type ModelRecord =
  | DraftAnalysis["claims"][number]
  | DraftAnalysis["requirements"][number]
  | DraftAnalysis["risks"][number]
  | DraftAnalysis["evaluation"]["rules"][number];

export interface RecordAuthorityBatch {
  binding: SubmissionBatchBinding;
  draft: DraftAnalysis;
  authority: RecordAuthorityEnvelope;
  /** Exact ephemeral map issued with this paid batch; never persisted. */
  sourceMap?: DocumentSourceMap;
}

export interface JoinedRecordAuthority {
  merged_record_id: string;
  canonical_record_digest: string;
  kind: RecordKind;
  relevance: SubmissionRelevance | null;
  source_binding: RecordSourceBinding;
  semantic_crosscheck: RecordSemanticCrosscheck;
  publication: RecordPublication;
  reason: string | null;
  contributing_origin_record_keys: string[];
  whole_bid_channels: SubmissionChannelSignature[];
}

export interface RecordAuthorityCitationOccurrence {
  pdf_page_1based: number;
  start_utf16: number;
  end_utf16: number;
  candidate_ids: string[];
  relation_binding_digests: string[];
}

export interface RecordAuthorityCitationBinding {
  document_sha256: string;
  evidence_quote_sha256: string;
  occurrences: RecordAuthorityCitationOccurrence[];
}

export interface VerifiedOriginRecordAuthority {
  origin_record_key: string;
  batch_id: string;
  kind: RecordKind;
  ordinal: number;
  relevance: SubmissionRelevance | null;
  canonical_record_digest: string;
  merged_record_id: string;
  source_binding: RecordSourceBinding;
  semantic_crosscheck: RecordSemanticCrosscheck;
  publication: RecordPublication;
  reason: string | null;
  citation_bindings: RecordAuthorityCitationBinding[];
}

export interface VerifiedRecordAuthorityManifest {
  version: 1 | 2 | typeof RECORD_AUTHORITY_VERSION;
  complete: boolean;
  package_veto: boolean;
  unresolved_reasons: string[];
  discarded_reasons: string[];
  receipt_byte_length: number;
  receipt_capacity_bytes: typeof MAX_RECORD_AUTHORITY_RECEIPT_BYTES;
  /** Server-computed digest over every origin and its merged attachment. */
  record_manifest_digest: string;
  origin_record_key_to_merged_record_id: Record<string, string>;
  origins: VerifiedOriginRecordAuthority[];
  records: JoinedRecordAuthority[];
}

interface AuthenticatedPresentationField {
  raw_sha256: string;
  projected_sha256: string;
  projected_value: string;
}

interface AuthenticatedPresentationRecord {
  alignment_version: typeof RECORD_SOURCE_ALIGNMENT_VERSION;
  canonical_record_digest: string;
  authority_binding_digest: string;
  fields: Partial<Record<RecordPresentationField, AuthenticatedPresentationField>>;
}

interface AuthenticatedPresentationSidecar {
  manifest_digest: string;
  records: Map<string, AuthenticatedPresentationRecord>;
}

// Deliberately process-local and weakly held. Full selector/source bodies and
// the sidecar must not enter the authority receipt, persistence, or logs. A
// validated projected field value may intentionally enter the public result.
const authenticatedPresentationSidecars = new WeakMap<
  VerifiedRecordAuthorityManifest,
  AuthenticatedPresentationSidecar
>();

export const RECORD_AUTHORITY_PUBLICATION_REASON_KEYS = [
  "verified",
  "source_unlocated",
  "source_coverage_gap",
  "source_relation_gap",
  "source_relation_conflict",
  "semantic_unknown",
  "semantic_disagreement",
  "receipt_integrity"
] as const;

export const RECORD_AUTHORITY_SUBMISSION_VETO_REASON_KEYS = [
  "exact_submission_coverage_gap",
  "exact_submission_relation_gap",
  "exact_submission_relation_conflict",
  "exact_non_submission_overlap",
  "exact_semantic_uncertainty",
  "exact_relevance_disagreement"
] as const;

function zeroCounts<const T extends readonly string[]>(keys: T): Record<T[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T[number], number>;
}

export function recordAuthorityDiagnosticCounters(manifest: VerifiedRecordAuthorityManifest) {
  const counters = {
    relevance: { s: 0, n: 0, u: 0, mixed: 0, missing: 0 },
    source_binding: { unlocated: 0, exact_bound: 0, coverage_gap: 0, relation_gap: 0,
      relation_conflict: 0 },
    semantic_crosscheck: { consistent: 0, disagrees: 0, unknown: 0 },
    publication: { verified: 0, discarded: 0 },
    publication_reason: zeroCounts(RECORD_AUTHORITY_PUBLICATION_REASON_KEYS),
    submission_veto_reason: zeroCounts(RECORD_AUTHORITY_SUBMISSION_VETO_REASON_KEYS)
  };
  for (const record of manifest.records) {
    const relevanceKey = record.relevance ??
      (record.reason === "duplicate_record_relevance_disagreement" ? "mixed" : "missing");
    counters.relevance[relevanceKey] += 1;
    counters.source_binding[record.source_binding] += 1;
    counters.semantic_crosscheck[record.semantic_crosscheck] += 1;
    counters.publication[record.publication] += 1;
    if (record.publication === "verified") {
      counters.publication_reason.verified += 1;
    } else if (!manifest.complete) {
      counters.publication_reason.receipt_integrity += 1;
    } else if (record.source_binding === "unlocated") {
      counters.publication_reason.source_unlocated += 1;
    } else if (record.source_binding === "coverage_gap") {
      counters.publication_reason.source_coverage_gap += 1;
    } else if (record.source_binding === "relation_gap") {
      counters.publication_reason.source_relation_gap += 1;
    } else if (record.source_binding === "relation_conflict") {
      counters.publication_reason.source_relation_conflict += 1;
    } else if (record.semantic_crosscheck === "disagrees") {
      counters.publication_reason.semantic_disagreement += 1;
    } else {
      counters.publication_reason.semantic_unknown += 1;
    }
    if (record.semantic_crosscheck !== "disagrees") continue;
    if (record.relevance === "s" && record.source_binding === "coverage_gap") {
      counters.submission_veto_reason.exact_submission_coverage_gap += 1;
    } else if (record.relevance === "s" && record.source_binding === "relation_gap") {
      counters.submission_veto_reason.exact_submission_relation_gap += 1;
    } else if (record.relevance === "s" && record.source_binding === "relation_conflict") {
      counters.submission_veto_reason.exact_submission_relation_conflict += 1;
    } else if (record.relevance === "n" && record.source_binding === "relation_conflict") {
      counters.submission_veto_reason.exact_non_submission_overlap += 1;
    } else if (record.relevance === "u" && record.source_binding === "exact_bound") {
      counters.submission_veto_reason.exact_semantic_uncertainty += 1;
    } else if (record.relevance === null && record.source_binding !== "unlocated" &&
      record.source_binding !== "coverage_gap") {
      counters.submission_veto_reason.exact_relevance_disagreement += 1;
    }
  }
  return counters;
}

function authorityManifestDigestPayload(input: Pick<VerifiedRecordAuthorityManifest,
  "version" | "complete" | "package_veto" | "unresolved_reasons" | "discarded_reasons" |
  "origin_record_key_to_merged_record_id" | "origins" | "records">) {
  return {
    version: input.version,
    complete: input.complete,
    package_veto: input.package_veto,
    unresolved_reasons: input.unresolved_reasons,
    discarded_reasons: input.discarded_reasons,
    origin_record_key_to_merged_record_id: input.origin_record_key_to_merged_record_id,
    origins: input.origins,
    records: input.records
  };
}

export function verifiedRecordAuthorityManifestDigest(input: Pick<VerifiedRecordAuthorityManifest,
  "version" | "complete" | "package_veto" | "unresolved_reasons" | "discarded_reasons" |
  "origin_record_key_to_merged_record_id" | "origins" | "records">) {
  return sha256Hex(stableJson(authorityManifestDigestPayload(input)));
}

export function recordAuthorityReceiptWithinCapacity(byteLength: number) {
  return Number.isSafeInteger(byteLength) && byteLength >= 0 &&
    byteLength <= MAX_RECORD_AUTHORITY_RECEIPT_BYTES;
}

type UnsealedRecordAuthorityManifest = Omit<VerifiedRecordAuthorityManifest,
  "record_manifest_digest" | "receipt_byte_length" | "receipt_capacity_bytes">;

function sealRecordAuthorityManifest(
  input: UnsealedRecordAuthorityManifest
): VerifiedRecordAuthorityManifest {
  const receiptByteLength = new TextEncoder().encode(
    stableJson(authorityManifestDigestPayload(input))
  ).byteLength;
  return {
    ...input,
    receipt_byte_length: receiptByteLength,
    receipt_capacity_bytes: MAX_RECORD_AUTHORITY_RECEIPT_BYTES,
    record_manifest_digest: verifiedRecordAuthorityManifestDigest(input)
  };
}

export function recordAuthorityManifestIntegrity(input: VerifiedRecordAuthorityManifest) {
  // Versions 1 and 2 coupled record publication to package authority. They are
  // deliberately not guessed forward: old receipts suppress model records.
  if (input.version !== RECORD_AUTHORITY_VERSION || !Array.isArray(input.discarded_reasons)) {
    return false;
  }
  const contributors = input.records.flatMap((record) => record.contributing_origin_record_keys.map(
    (origin) => ({ origin, mergedId: record.merged_record_id })
  ));
  const contributorKeys = contributors.map((item) => item.origin);
  const mappingKeys = Object.keys(input.origin_record_key_to_merged_record_id);
  const receiptBytes = new TextEncoder().encode(stableJson(authorityManifestDigestPayload(input))).byteLength;
  const originKeys = input.origins.map((origin) => origin.origin_record_key);
  const recordKeys = input.records.map((record) => `${record.kind}:${record.merged_record_id}`);
  const sourceBindings = new Set<RecordSourceBinding>([
    "unlocated", "exact_bound", "coverage_gap", "relation_gap", "relation_conflict"
  ]);
  const semanticCrosschecks = new Set<RecordSemanticCrosscheck>([
    "consistent", "disagrees", "unknown"
  ]);
  const publications = new Set<RecordPublication>(["verified", "discarded"]);
  const relevances = new Set<SubmissionRelevance | null>(["s", "n", "u", null]);
  const shapesValid = [...input.records, ...input.origins].every((item) =>
    sourceBindings.has(item.source_binding) &&
    semanticCrosschecks.has(item.semantic_crosscheck) &&
    publications.has(item.publication) && relevances.has(item.relevance)
  ) && input.origins.every((origin) =>
    /^[a-f0-9]{64}$/.test(origin.origin_record_key) &&
    /^[a-f0-9]{64}$/.test(origin.canonical_record_digest) &&
    origin.citation_bindings.length <= MAX_MODEL_CITATIONS_PER_ANNOTATED_RECORD &&
    origin.citation_bindings.every((binding) =>
      /^[a-f0-9]{64}$/.test(binding.document_sha256) &&
      /^[a-f0-9]{64}$/.test(binding.evidence_quote_sha256) &&
      binding.occurrences.length <= MAX_EXACT_OCCURRENCES_PER_CITATION &&
      binding.occurrences.every((occurrence) =>
        occurrence.pdf_page_1based > 0 && occurrence.start_utf16 >= 0 &&
        occurrence.end_utf16 > occurrence.start_utf16 &&
        occurrence.relation_binding_digests.every((digest) => /^[a-f0-9]{64}$/.test(digest))
      )
    ) && (origin.publication !== "verified" || (
      origin.source_binding === "exact_bound" &&
      origin.semantic_crosscheck === "consistent" && origin.relevance !== null &&
      origin.reason === null
    ))
  );
  const originsByKey = new Map(input.origins.map((origin) => [origin.origin_record_key, origin]));
  const joinedSemanticsValid = input.complete
    ? input.records.every((record) => {
        const group = record.contributing_origin_record_keys.map((key) => originsByKey.get(key));
        if (group.some((origin) => !origin)) return false;
        const concrete = group as VerifiedOriginRecordAuthority[];
        const groupRelevances = new Set(concrete.map((origin) => origin.relevance));
        const allExact = concrete.every((origin) => origin.source_binding !== "unlocated" &&
          origin.source_binding !== "coverage_gap");
        const expectedRelevance = groupRelevances.size === 1 ? [...groupRelevances][0]! : null;
        const expectedSourceBinding = concrete.map((origin) => origin.source_binding)
          .toSorted((left, right) => sourceBindingRank(right) - sourceBindingRank(left))[0] ??
          "unlocated";
        const expectedCrosscheck = concrete.some((origin) =>
          origin.semantic_crosscheck === "disagrees"
        ) || (groupRelevances.size !== 1 && allExact)
          ? "disagrees"
          : concrete.some((origin) => origin.semantic_crosscheck === "unknown") ||
              groupRelevances.size !== 1
            ? "unknown"
            : "consistent";
        const expectedPublication = concrete.every((origin) => origin.publication === "verified") &&
          groupRelevances.size === 1 && expectedCrosscheck === "consistent"
          ? "verified"
          : "discarded";
        return record.relevance === expectedRelevance &&
          record.source_binding === expectedSourceBinding &&
          record.semantic_crosscheck === expectedCrosscheck &&
          record.publication === expectedPublication &&
          concrete.every((origin) => origin.kind === record.kind &&
            origin.merged_record_id === record.merged_record_id &&
            origin.canonical_record_digest === record.canonical_record_digest);
      })
    : input.package_veto === false && input.records.every((record) =>
        record.publication === "discarded" && record.semantic_crosscheck === "unknown"
      );
  return input.receipt_capacity_bytes === MAX_RECORD_AUTHORITY_RECEIPT_BYTES &&
    input.receipt_byte_length === receiptBytes && receiptBytes <= MAX_RECORD_AUTHORITY_RECEIPT_BYTES &&
    input.record_manifest_digest === verifiedRecordAuthorityManifestDigest(input) &&
    shapesValid && joinedSemanticsValid && new Set(recordKeys).size === recordKeys.length &&
    new Set(originKeys).size === originKeys.length &&
    originKeys.length === contributorKeys.length &&
    new Set(contributorKeys).size === contributorKeys.length &&
    new Set(mappingKeys).size === mappingKeys.length &&
    contributorKeys.length === mappingKeys.length &&
    input.package_veto === (input.complete && input.records.some((record) =>
      record.semantic_crosscheck === "disagrees"
    )) && input.records.every((record) =>
      record.publication === "verified"
        ? record.source_binding === "exact_bound" &&
          record.semantic_crosscheck === "consistent" && record.relevance !== null
        : true
    ) && contributors.every(({ origin, mergedId }) =>
      input.origin_record_key_to_merged_record_id[origin] === mergedId
    ) && input.origins.every((origin) =>
      input.origin_record_key_to_merged_record_id[origin.origin_record_key] === origin.merged_record_id &&
      input.records.some((record) => record.kind === origin.kind &&
        record.merged_record_id === origin.merged_record_id &&
        record.canonical_record_digest === origin.canonical_record_digest &&
        record.contributing_origin_record_keys.includes(origin.origin_record_key))
    );
}

interface OriginRecord {
  originKey: string;
  kind: RecordKind;
  ordinal: number;
  record: ModelRecord;
  binding: SubmissionBatchBinding;
  relevance: SubmissionRelevance | null;
  sourceBinding: RecordSourceBinding;
  semanticCrosscheck: RecordSemanticCrosscheck;
  publication: RecordPublication;
  reason: string | null;
  wholeBidChannels: Set<SubmissionChannelSignature>;
  citationBindings: RecordAuthorityCitationBinding[];
  /** Ephemeral authenticated selector bodies; never copied into the receipt. */
  selectedSourceSpans: Array<{
    citationOrdinal: number;
    sourceText: string;
    evidenceQuote: string;
  }>;
}

export function recordsIn(draft: DraftAnalysis): Array<{
  kind: RecordKind;
  ordinal: number;
  record: ModelRecord;
}> {
  return [
    ...draft.claims.map((record, ordinal) => ({ kind: "c" as const, ordinal, record })),
    ...draft.requirements.map((record, ordinal) => ({ kind: "q" as const, ordinal, record })),
    ...draft.risks.map((record, ordinal) => ({ kind: "r" as const, ordinal, record })),
    ...draft.evaluation.rules.map((record, ordinal) => ({ kind: "e" as const, ordinal, record }))
  ];
}

export function publicRecordId(kind: RecordKind, record: ModelRecord) {
  if (kind === "c") return (record as DraftAnalysis["claims"][number]).claim_id;
  return (record as Exclude<ModelRecord, DraftAnalysis["claims"][number]>).id;
}

export function canonicalModelRecord(kind: RecordKind, record: ModelRecord) {
  const excludedKey = kind === "c" ? "claim_id" : "id";
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== excludedKey));
}

export function canonicalModelRecordSerialization(kind: RecordKind, record: ModelRecord) {
  return stableJson(canonicalModelRecord(kind, record));
}

export function canonicalModelRecordDigest(kind: RecordKind, record: ModelRecord) {
  return sha256Hex(canonicalModelRecordSerialization(kind, record));
}

function withPublicRecordId(kind: RecordKind, record: ModelRecord, id: string): ModelRecord {
  return kind === "c"
    ? { ...(record as DraftAnalysis["claims"][number]), claim_id: id }
    : { ...(record as Exclude<ModelRecord, DraftAnalysis["claims"][number]>), id };
}

export interface CanonicalRecordMerge {
  canonicalSerialization: string;
  canonicalDigest: string;
  mergedId: string;
  mergedRecord: ModelRecord;
}

export function planCanonicalRecordMerge(
  kind: RecordKind,
  records: ModelRecord[]
): CanonicalRecordMerge[] {
  const groups = new Map<string, ModelRecord[]>();
  for (const record of records) {
    const canonical = canonicalModelRecordSerialization(kind, record);
    groups.set(canonical, [...(groups.get(canonical) ?? []), record]);
  }
  const provisional = [...groups].map(([canonicalSerialization, group]) => {
    const representative = group.toSorted((left, right) =>
      publicRecordId(kind, left).localeCompare(publicRecordId(kind, right))
    )[0]!;
    return {
      canonicalSerialization,
      canonicalDigest: sha256Hex(canonicalSerialization),
      baseId: publicRecordId(kind, representative),
      representative
    };
  });
  const baseIdCounts = new Map<string, number>();
  for (const item of provisional) {
    baseIdCounts.set(item.baseId, (baseIdCounts.get(item.baseId) ?? 0) + 1);
  }
  return provisional.map((item) => {
    const mergedId = (baseIdCounts.get(item.baseId) ?? 0) === 1
      ? item.baseId
      : `${item.baseId.slice(0, 180)}~${item.canonicalDigest.slice(0, 16)}`;
    return {
      canonicalSerialization: item.canonicalSerialization,
      canonicalDigest: item.canonicalDigest,
      mergedId,
      mergedRecord: withPublicRecordId(kind, item.representative, mergedId)
    };
  });
}

function citations(record: ModelRecord) {
  return record.citations;
}

export function recordAuthorityManifestDigest(draft: DraftAnalysis) {
  return sha256Hex(stableJson(recordsIn(draft).map(({ kind, ordinal, record }) => ({
    kind,
    ordinal,
    record
  }))));
}

export function maximumRecordAuthorityEnvelope(draft: DraftAnalysis) {
  return JSON.stringify({
    v: RECORD_AUTHORITY_ENVELOPE_VERSION,
    r: recordsIn(draft).slice(0, MAX_RECORD_AUTHORITY_RECORDS_PER_BATCH)
      .map(({ kind, ordinal }) => [kind, ordinal, "u", []])
  });
}

const DROPPED_REPRESENTATION_CHARACTERS = /[\u00ad\u200b-\u200d\ufeff]/u;
const COMPATIBILITY_GLYPHS: Readonly<Record<string, string>> = {
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-",
  "“": "\"", "”": "\"", "‘": "'", "’": "'",
  "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl",
  "ﬅ": "st", "ﬆ": "st"
};

function markdownLayoutIndexes(value: string) {
  const ignored = new Set<number>();
  const lines: Array<{ body: string; start: number }> = [];
  let lineStart = 0;
  for (const line of value.split(/(?<=\n)/u)) {
    const body = line.endsWith("\n") ? line.slice(0, -1) : line;
    lines.push({ body, start: lineStart });
    lineStart += line.length;
  }
  const cells = (body: string) => {
    if (!body.includes("|")) return null;
    const parts = body.split("|");
    if (body.trimStart().startsWith("|")) parts.shift();
    if (body.trimEnd().endsWith("|")) parts.pop();
    return parts.length >= 2 ? parts : null;
  };
  const ignorePipes = (line: { body: string; start: number }) => {
    for (let index = 0; index < line.body.length; index += 1) {
      if (line.body[index] === "|") ignored.add(line.start + index);
    }
  };
  const isEscaped = (body: string, index: number) => {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && body[cursor] === "\\"; cursor -= 1) slashes += 1;
    return slashes % 2 === 1;
  };
  const markDelimiterPairs = (
    line: { body: string; start: number },
    delimiter: "**" | "__"
  ) => {
    // Backtick contents are literal Markdown code. Conservatively retain every
    // marker on such lines instead of interpreting a literal as presentation.
    if (line.body.includes("`")) return;
    const marker = delimiter[0]!;
    const exactDelimiterRun = (index: number) =>
      line.body[index - 1] !== marker &&
      line.body[index + delimiter.length] !== marker;
    for (let opener = 0; opener <= line.body.length - delimiter.length;) {
      opener = line.body.indexOf(delimiter, opener);
      if (opener < 0) break;
      const before = line.body[opener - 1];
      const after = line.body[opener + delimiter.length];
      if (!exactDelimiterRun(opener) || isEscaped(line.body, opener) || !after || /\s/u.test(after) ||
        /[\p{L}\p{N}]/u.test(before ?? "")) {
        opener += delimiter.length;
        continue;
      }
      let closer = opener + delimiter.length;
      let found = -1;
      while (closer <= line.body.length - delimiter.length) {
        closer = line.body.indexOf(delimiter, closer);
        if (closer < 0) break;
        const innerLast = line.body[closer - 1];
        const afterCloser = line.body[closer + delimiter.length];
        if (exactDelimiterRun(closer) && !isEscaped(line.body, closer) &&
          innerLast && !/\s/u.test(innerLast) &&
          !/[\p{L}\p{N}]/u.test(afterCloser ?? "")) {
          found = closer;
          break;
        }
        closer += delimiter.length;
      }
      if (found < 0) {
        opener += delimiter.length;
        continue;
      }
      for (let index = 0; index < delimiter.length; index += 1) {
        ignored.add(line.start + opener + index);
        ignored.add(line.start + found + index);
      }
      opener = found + delimiter.length;
    }
  };
  for (const line of lines) {
    const heading = /^( {0,3})(#{1,6})(?=\s|$)/u.exec(line.body);
    if (heading) {
      const markerStart = heading[1]!.length;
      for (let index = 0; index < heading[2]!.length; index += 1) {
        ignored.add(line.start + markerStart + index);
      }
    }
    markDelimiterPairs(line, "**");
    markDelimiterPairs(line, "__");
  }
  for (let delimiterIndex = 1; delimiterIndex < lines.length; delimiterIndex += 1) {
    const header = lines[delimiterIndex - 1]!;
    const delimiter = lines[delimiterIndex]!;
    const headerCells = cells(header.body);
    const delimiterCells = cells(delimiter.body);
    if (!headerCells || !delimiterCells || headerCells.length !== delimiterCells.length ||
      headerCells.some((cell) => cell.trim() === "") ||
      !delimiterCells.every((cell) => /^\s*:?-{3,}:?\s*$/u.test(cell))) continue;
    ignorePipes(header);
    for (let index = 0; index < delimiter.body.length; index += 1) {
      if (!/\s/u.test(delimiter.body[index]!)) ignored.add(delimiter.start + index);
    }
    for (let rowIndex = delimiterIndex + 1; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex]!;
      const rowCells = cells(row.body);
      if (!rowCells || rowCells.length !== headerCells.length) break;
      ignorePipes(row);
    }
  }
  return ignored;
}

function alignmentUnits(
  value: string,
  options: { markdown: boolean; pdfPage1Based: number | null }
) {
  const ignored = options.markdown ? markdownLayoutIndexes(value) : new Set<number>();
  const units: AlignmentUnit[] = [];
  for (let rawStart = 0; rawStart < value.length;) {
    const codePoint = value.codePointAt(rawStart);
    if (codePoint === undefined) break;
    const source = String.fromCodePoint(codePoint);
    const rawEnd = rawStart + source.length;
    if (ignored.has(rawStart) || DROPPED_REPRESENTATION_CHARACTERS.test(source)) {
      rawStart = rawEnd;
      continue;
    }
    const normalized = COMPATIBILITY_GLYPHS[source] ?? source;
    if (/^\s+$/u.test(normalized)) {
      const previous = units.at(-1);
      if (previous?.value === " ") previous.rawEnd = rawEnd;
      else units.push({
        value: " ", rawStart, rawEnd, pdfPage1Based: options.pdfPage1Based
      });
    } else {
      for (let index = 0; index < normalized.length; index += 1) {
        units.push({
          value: normalized[index]!, rawStart, rawEnd,
          pdfPage1Based: options.pdfPage1Based
        });
      }
    }
    rawStart = rawEnd;
  }
  while (units[0]?.value === " ") units.shift();
  while (units.at(-1)?.value === " ") units.pop();
  return units;
}

function contextualPresentationProjection(selectorSource: string, rawValue: string) {
  const occurrences = everyMatch(selectorSource, rawValue);
  if (occurrences.length !== 1) return null;
  const fieldStart = occurrences[0]!;
  const fieldEnd = fieldStart + rawValue.length;
  const selectorUnits = alignmentUnits(selectorSource, {
    markdown: true,
    pdfPage1Based: null
  });
  const intersecting = selectorUnits.filter((unit) =>
    unit.rawStart < fieldEnd && unit.rawEnd > fieldStart
  );
  if (intersecting.some((unit) => unit.value !== " " &&
    (unit.rawStart < fieldStart || unit.rawEnd > fieldEnd))) return null;
  const fieldUnits = selectorUnits.filter((unit) =>
    unit.rawStart >= fieldStart && unit.rawEnd <= fieldEnd
  );
  while (fieldUnits[0]?.value === " ") fieldUnits.shift();
  while (fieldUnits.at(-1)?.value === " ") fieldUnits.pop();
  return fieldUnits.length > 0 ? fieldUnits.map((unit) => unit.value).join("") : null;
}

function presentationFields(
  kind: RecordKind,
  record: ModelRecord
): Array<[RecordPresentationField, string]> {
  if (kind === "c") {
    return [["claim_text", (record as DraftAnalysis["claims"][number]).claim_text]];
  }
  if (kind === "q") {
    const requirement = record as DraftAnalysis["requirements"][number];
    const fields: Array<[RecordPresentationField, string]> = [
      ["requirement_text", requirement.text]
    ];
    if (requirement.evidence_needed) {
      fields.push(["requirement_evidence_needed", requirement.evidence_needed]);
    }
    if (requirement.consequence) {
      fields.push(["requirement_consequence", requirement.consequence]);
    }
    return fields;
  }
  if (kind === "r") {
    const risk = record as DraftAnalysis["risks"][number];
    return [
      ["risk_finding", risk.finding],
      ["risk_impact", risk.impact],
      ["risk_recommended_action", risk.recommended_action]
    ];
  }
  return [["evaluation_value", (record as DraftAnalysis["evaluation"]["rules"][number]).value]];
}

function authorityBindingDigest(
  manifest: VerifiedRecordAuthorityManifest,
  record: JoinedRecordAuthority
) {
  const origins = record.contributing_origin_record_keys.map((key) =>
    manifest.origins.find((origin) => origin.origin_record_key === key)
  );
  if (origins.some((origin) => !origin)) return null;
  return sha256Hex(stableJson(origins.map((origin) => ({
    origin_record_key: origin!.origin_record_key,
    canonical_record_digest: origin!.canonical_record_digest,
    publication: origin!.publication,
    citation_bindings: origin!.citation_bindings
  }))));
}

function attachAuthenticatedPresentationSidecar(
  manifest: VerifiedRecordAuthorityManifest,
  groups: ReadonlyMap<string, OriginRecord[]>
) {
  if (!recordAuthorityManifestIntegrity(manifest)) return;
  const records = new Map<string, AuthenticatedPresentationRecord>();
  for (const record of manifest.records) {
    if (record.publication !== "verified") continue;
    const group = groups.get(`${record.kind}:${record.merged_record_id}`);
    const bindingDigest = authorityBindingDigest(manifest, record);
    if (!group || !bindingDigest || group.length === 0 ||
      group.some((origin) => origin.publication !== "verified")) continue;
    const representative = group[0]!.record;
    const fields: Partial<Record<RecordPresentationField, AuthenticatedPresentationField>> = {};
    for (const [field, rawValue] of presentationFields(record.kind, representative)) {
      const projections = group.map((origin) => {
        if (!presentationFields(origin.kind, origin.record).some(
          ([candidateField, candidateValue]) =>
            candidateField === field && candidateValue === rawValue
        )) return null;
        const paired = origin.selectedSourceSpans.flatMap((selection) => {
          const selectedCitation = citations(origin.record)[selection.citationOrdinal];
          if (!selectedCitation || selectedCitation.evidence_quote !== selection.evidenceQuote) {
            return [];
          }
          const projected = contextualPresentationProjection(selection.sourceText, rawValue);
          if (!projected || projected === rawValue) return [];
          const exactPdfValue = alignmentUnits(selection.evidenceQuote, {
            markdown: false,
            pdfPage1Based: null
          }).map((unit) => unit.value).join("");
          return exactPdfValue.includes(projected) ? [projected] : [];
        });
        return paired.length === 1 ? paired[0]! : null;
      });
      if (projections.some((projection) => projection === null)) continue;
      const uniqueProjections = new Set(projections as string[]);
      if (uniqueProjections.size !== 1) continue;
      const projectedValue = [...uniqueProjections][0]!;
      fields[field] = {
        raw_sha256: sha256Hex(rawValue),
        projected_sha256: sha256Hex(projectedValue),
        projected_value: projectedValue
      };
    }
    if (Object.keys(fields).length === 0) continue;
    records.set(`${record.kind}:${record.merged_record_id}`, {
      alignment_version: RECORD_SOURCE_ALIGNMENT_VERSION,
      canonical_record_digest: record.canonical_record_digest,
      authority_binding_digest: bindingDigest,
      fields
    });
  }
  authenticatedPresentationSidecars.set(manifest, {
    manifest_digest: manifest.record_manifest_digest,
    records
  });
}

/**
 * Returns only a process-local projection authenticated by the exact selector,
 * physical-page binding, canonical record, receipt digest, and transform
 * version. A cloned, persisted, mutated, or independently constructed receipt
 * has no sidecar and therefore fails closed.
 */
export function selectorAuthenticatedPresentationValue(
  manifest: VerifiedRecordAuthorityManifest,
  kind: RecordKind,
  recordId: string,
  field: RecordPresentationField,
  rawValue: string
) {
  const sidecar = authenticatedPresentationSidecars.get(manifest);
  if (!sidecar || sidecar.manifest_digest !== manifest.record_manifest_digest ||
    manifest.version !== RECORD_AUTHORITY_VERSION || !manifest.complete) return null;
  const authority = manifest.records.find((record) =>
    record.kind === kind && record.merged_record_id === recordId
  );
  const projection = sidecar.records.get(`${kind}:${recordId}`);
  if (!authority || authority.publication !== "verified" || !projection ||
    projection.alignment_version !== RECORD_SOURCE_ALIGNMENT_VERSION ||
    projection.canonical_record_digest !== authority.canonical_record_digest ||
    projection.authority_binding_digest !== authorityBindingDigest(manifest, authority)) return null;
  const candidate = projection.fields[field];
  if (!candidate || candidate.raw_sha256 !== sha256Hex(rawValue) ||
    candidate.projected_sha256 !== sha256Hex(candidate.projected_value)) return null;
  return candidate.projected_value;
}

function everyMatch(value: string, needle: string) {
  if (!needle) return [];
  const matches: number[] = [];
  let cursor = 0;
  while (cursor <= value.length - needle.length) {
    const match = value.indexOf(needle, cursor);
    if (match < 0) break;
    matches.push(match);
    cursor = match + 1;
  }
  return matches;
}

export function buildDocumentSourceMap(
  fragments: SourceMapFragment[],
  documents: CitationDocument[]
): DocumentSourceMap {
  const pagesByDocument = new Map(documents.map((document) => [
    document.index.documentSha256,
    document.index.pages.map((page) => ({
      pdfPage1Based: page.pdfPage1Based,
      text: page.text,
      units: alignmentUnits(page.text, {
        markdown: false,
        pdfPage1Based: page.pdfPage1Based
      })
    }))
  ]));
  const mapped = new Map<string, AlignedSourceFragment>();
  for (const fragment of fragments) {
    if (mapped.has(fragment.source_fragment_id)) continue;
    mapped.set(fragment.source_fragment_id, {
      source_fragment_id: fragment.source_fragment_id,
      document_sha256: fragment.document_sha256,
      chunk_id: fragment.chunk_id,
      source_text: fragment.text,
      source_text_length: fragment.text.length,
      source_representation_sha256: sha256Hex(fragment.text),
      source_units: alignmentUnits(fragment.text, {
        markdown: fragment.origin?.kind !== "submission_coverage",
        pdfPage1Based: null
      }),
      origin: fragment.origin ?? { kind: "source_fragment" }
    });
  }
  return {
    alignment_version: RECORD_SOURCE_ALIGNMENT_VERSION,
    fragments: mapped,
    pages_by_document: pagesByDocument
  };
}

const SOURCE_CONTEXT_UNITS = 64;

export function resolveSemanticSpan(
  sourceMap: DocumentSourceMap,
  selector: SemanticSpanSelector,
  documents: CitationDocument[]
): ResolvedSemanticSpan | null {
  const fragment = sourceMap.fragments.get(selector.source_fragment_id);
  const selectorEnd = selector.start_utf16 + selector.length_utf16;
  if (!fragment || !Number.isSafeInteger(selector.start_utf16) || selector.start_utf16 < 0 ||
    !Number.isSafeInteger(selector.length_utf16) || selector.length_utf16 < 1 ||
    selector.length_utf16 > 500 || !Number.isSafeInteger(selectorEnd) ||
    selectorEnd > fragment.source_text_length) return null;
  if (fragment.origin.kind === "submission_coverage") {
    if (!sourceOriginIntegrity(sourceMap, fragment)) return null;
    const origin = fragment.origin;
    const evidenceStart = origin.source_start_utf16 + selector.start_utf16;
    const evidenceEnd = origin.source_start_utf16 + selectorEnd;
    const page = (sourceMap.pages_by_document.get(fragment.document_sha256) ?? []).find((item) =>
      item.pdfPage1Based === origin.pdf_page_1based
    );
    const evidenceQuote = page?.text.slice(evidenceStart, evidenceEnd) ?? "";
    if (!page || !evidenceQuote || evidenceQuote.length > 500 ||
      evidenceQuote !== fragment.source_text.slice(selector.start_utf16, selectorEnd) ||
      !isWellFormedUtf16(evidenceQuote)) return null;
    return {
      document_sha256: fragment.document_sha256,
      chunk_id: fragment.chunk_id,
      evidence_quote: evidenceQuote,
      binding: {
        source_fragment_id: fragment.source_fragment_id,
        source_representation_sha256: fragment.source_representation_sha256,
        selector_start_utf16: selector.start_utf16,
        selector_end_utf16: selectorEnd,
        document_sha256: fragment.document_sha256,
        pdf_page_1based: origin.pdf_page_1based,
        page_text_sha256: origin.page_text_sha256,
        evidence_start_utf16: evidenceStart,
        evidence_end_utf16: evidenceEnd,
        evidence_quote_sha256: sha256Hex(evidenceQuote),
        alignment_version: RECORD_SOURCE_ALIGNMENT_VERSION
      }
    };
  }
  const intersectingUnits = fragment.source_units.filter((unit) =>
    unit.rawStart < selectorEnd && unit.rawEnd > selector.start_utf16
  );
  if (intersectingUnits.some((unit) => unit.value !== " " &&
    (unit.rawStart < selector.start_utf16 || unit.rawEnd > selectorEnd))) return null;
  const overlappingUnits = fragment.source_units.filter((unit) =>
    unit.rawStart >= selector.start_utf16 && unit.rawEnd <= selectorEnd
  );
  while (overlappingUnits[0]?.value === " ") overlappingUnits.shift();
  while (overlappingUnits.at(-1)?.value === " ") overlappingUnits.pop();
  if (overlappingUnits.length === 0) return null;
  const firstSourceUnit = fragment.source_units.indexOf(overlappingUnits[0]!);
  const lastSourceUnit = fragment.source_units.indexOf(overlappingUnits.at(-1)!);
  const selectedValue = overlappingUnits.map((unit) => unit.value).join("");
  const candidates = (sourceMap.pages_by_document.get(fragment.document_sha256) ?? []).flatMap(
    (page) => {
      const pageValue = page.units.map((unit) => unit.value).join("");
      return everyMatch(pageValue, selectedValue).flatMap((matchStart) => {
        const targetUnits = page.units.slice(matchStart, matchStart + overlappingUnits.length);
        if (targetUnits.length !== overlappingUnits.length) return [];
        const firstTarget = targetUnits[0]!;
        const lastTarget = targetUnits.at(-1)!;
        const precedingTarget = page.units[matchStart - 1];
        const followingTarget = page.units[matchStart + targetUnits.length];
        const sharesRawOrigin = (left: AlignmentUnit | undefined, right: AlignmentUnit) =>
          left?.rawStart === right.rawStart && left.rawEnd === right.rawEnd;
        if (sharesRawOrigin(precedingTarget, firstTarget) ||
          sharesRawOrigin(followingTarget, lastTarget)) return [];
        const evidenceStart = firstTarget.rawStart;
        const evidenceEnd = lastTarget.rawEnd;
        const evidenceQuote = page.text.slice(evidenceStart, evidenceEnd);
        const normalizedEvidence = alignmentUnits(evidenceQuote, {
          markdown: false,
          pdfPage1Based: page.pdfPage1Based
        }).map((unit) => unit.value).join("");
        return evidenceQuote && evidenceQuote.length <= 500 && normalizedEvidence === selectedValue
          ? [{ page, matchStart, evidenceStart, evidenceEnd, evidenceQuote }]
          : [];
      });
    }
  );
  let survivors = candidates;
  if (survivors.length > 1) {
    const leftContext = fragment.source_units.slice(
      Math.max(0, firstSourceUnit - SOURCE_CONTEXT_UNITS),
      firstSourceUnit
    );
    const rightContext = fragment.source_units.slice(
      lastSourceUnit + 1,
      lastSourceUnit + 1 + SOURCE_CONTEXT_UNITS
    );
    if (leftContext.length === 0 && rightContext.length === 0) return null;
    const leftValue = leftContext.map((unit) => unit.value).join("");
    const rightValue = rightContext.map((unit) => unit.value).join("");
    survivors = survivors.filter(({ page, matchStart }) => {
      const leftStart = matchStart - leftContext.length;
      const rightStart = matchStart + overlappingUnits.length;
      if (leftContext.length > 0 && (leftStart < 0 ||
        page.units.slice(leftStart, matchStart).map((unit) => unit.value).join("") !== leftValue)) {
        return false;
      }
      return rightContext.length === 0 ||
        page.units.slice(rightStart, rightStart + rightContext.length)
          .map((unit) => unit.value).join("") === rightValue;
    });
  }
  if (survivors.length !== 1) return null;
  const { page: alignedPage, evidenceStart, evidenceEnd, evidenceQuote } = survivors[0]!;
  const pageNumber = alignedPage.pdfPage1Based;
  const document = documents.find((item) =>
    item.index.documentSha256 === fragment.document_sha256
  );
  const page = document?.index.pages.find((item) => item.pdfPage1Based === pageNumber);
  if (!page || evidenceEnd <= evidenceStart || evidenceEnd > page.text.length) return null;
  if (page.text.slice(evidenceStart, evidenceEnd) !== evidenceQuote) return null;
  return {
    document_sha256: fragment.document_sha256,
    chunk_id: fragment.chunk_id,
    evidence_quote: evidenceQuote,
    binding: {
      source_fragment_id: fragment.source_fragment_id,
      source_representation_sha256: fragment.source_representation_sha256,
      selector_start_utf16: selector.start_utf16,
      selector_end_utf16: selectorEnd,
      document_sha256: fragment.document_sha256,
      pdf_page_1based: pageNumber,
      page_text_sha256: sha256Hex(page.text),
      evidence_start_utf16: evidenceStart,
      evidence_end_utf16: evidenceEnd,
      evidence_quote_sha256: sha256Hex(evidenceQuote),
      alignment_version: RECORD_SOURCE_ALIGNMENT_VERSION
    }
  };
}

/**
 * Inverse lookup used by local proof fixtures: find private selectors whose
 * verified result is strictly representation-equivalent to a frozen citation.
 * Production does not use this to author selectors; the provider must still
 * choose one issued source fragment and bounded span in the same response.
 */
export function selectorsForEvidenceRepresentation(
  sourceMap: DocumentSourceMap,
  evidence: {
    document_sha256: string;
    pdf_page_1based: number;
    evidence_quote: string;
  },
  documents: CitationDocument[]
) {
  const document = documents.find((item) =>
    item.index.documentSha256 === evidence.document_sha256
  );
  const page = document?.index.pages.find((item) =>
    item.pdfPage1Based === evidence.pdf_page_1based
  );
  if (!page || !evidence.evidence_quote || evidence.evidence_quote.length > 500) return [];
  const evidenceUnits = alignmentUnits(evidence.evidence_quote, {
    markdown: false,
    pdfPage1Based: evidence.pdf_page_1based
  });
  const evidenceValue = evidenceUnits.map((unit) => unit.value).join("");
  if (!evidenceValue) return [];
  const selectors: SemanticSpanSelector[] = [];
  for (const fragment of sourceMap.fragments.values()) {
    if (fragment.document_sha256 !== evidence.document_sha256) continue;
    const sourceValue = fragment.source_units.map((unit) => unit.value).join("");
    for (const sourceStartIndex of everyMatch(sourceValue, evidenceValue)) {
      const sourceEndIndex = sourceStartIndex + evidenceUnits.length - 1;
      const sourceStartUnit = fragment.source_units[sourceStartIndex];
      const sourceEndUnit = fragment.source_units[sourceEndIndex];
      if (!sourceStartUnit || !sourceEndUnit || sourceEndIndex < sourceStartIndex) continue;
      const selector = {
        source_fragment_id: fragment.source_fragment_id,
        start_utf16: sourceStartUnit.rawStart,
        length_utf16: sourceEndUnit.rawEnd - sourceStartUnit.rawStart
      };
      const resolved = resolveSemanticSpan(sourceMap, selector, documents);
      if (resolved?.document_sha256 === evidence.document_sha256 &&
        resolved.binding.pdf_page_1based === evidence.pdf_page_1based &&
        alignmentUnits(resolved.evidence_quote, {
          markdown: false,
          pdfPage1Based: evidence.pdf_page_1based
        }).map((unit) => unit.value).join("") === evidenceValue) selectors.push(selector);
    }
  }
  return selectors;
}

function mergedIds(origins: OriginRecord[]) {
  const byKind = new Map<RecordKind, OriginRecord[]>();
  for (const origin of origins) byKind.set(origin.kind, [...(byKind.get(origin.kind) ?? []), origin]);
  const result = new Map<string, string>();
  for (const [kind, values] of byKind) {
    const groups = new Map<string, OriginRecord[]>();
    for (const value of values) {
      const key = canonicalModelRecordSerialization(kind, value.record);
      groups.set(key, [...(groups.get(key) ?? []), value]);
    }
    // Use the same complete record set as mergeDrafts. Passing only one
    // representative per canonical group can choose a different public ID
    // when equivalent records arrived with different model-authored IDs.
    const plan = new Map(planCanonicalRecordMerge(
      kind,
      values.map((value) => value.record)
    ).map((item) => [item.canonicalSerialization, item]));
    for (const [canonical, group] of groups) {
      const mergedId = plan.get(canonical)?.mergedId;
      if (!mergedId) continue;
      for (const origin of group) result.set(origin.originKey, mergedId);
    }
  }
  return result;
}

function sourceBindingRank(value: RecordSourceBinding) {
  return ({
    exact_bound: 0,
    unlocated: 1,
    coverage_gap: 2,
    relation_gap: 3,
    relation_conflict: 4
  } satisfies Record<RecordSourceBinding, number>)[value];
}

export function verifyRecordAuthorities(input: {
  batches: RecordAuthorityBatch[];
  ledger: SubmissionCandidateLedger;
  submission: VerifiedSubmissionAdjudication;
  documents: CitationDocument[];
  /** Exact result of the same merge operation that will be materialized. */
  mergedDraft?: DraftAnalysis;
}): VerifiedRecordAuthorityManifest {
  const origins: OriginRecord[] = [];
  const receiptReasons: string[] = [];
  const submissionVetoReasons: string[] = [];
  const discardedReasons: string[] = [];
  const verifiedCoverage = new Map(input.submission.records.map((record) => [record.candidate_id, record]));
  const knownBatchIds = new Set(input.batches.map((batch) => batch.binding.batch_id));
  if (knownBatchIds.size !== input.batches.length) receiptReasons.push("duplicate_batch");

  for (const batch of input.batches) {
    const expected = recordsIn(batch.draft);
    const annotationGroups = new Map<string, Array<{
      relevance: SubmissionRelevance;
      bindings: RecordAuthorityPhysicalBinding[] | null;
    }>>();
    for (const annotation of batch.authority.r) {
      const [kind, ordinal, relevance] = annotation;
      const key = `${kind}:${ordinal}`;
      annotationGroups.set(key, [...(annotationGroups.get(key) ?? []), {
        relevance,
        bindings: batch.authority.v === RECORD_AUTHORITY_ENVELOPE_VERSION
          ? (annotation as z.infer<typeof RecordAuthorityBoundEnvelopeSchema>["r"][number])[3]
          : null
      }]);
    }
    const expectedKeys = new Set(expected.map(({ kind, ordinal }) => `${kind}:${ordinal}`));
    if (batch.authority.r.some(([kind, ordinal]) => !expectedKeys.has(`${kind}:${ordinal}`))) {
      receiptReasons.push("unknown_annotation");
    }
    if (expected.length > MAX_RECORD_AUTHORITY_RECORDS_PER_BATCH) {
      receiptReasons.push("record_authority_capacity");
    }

    for (const { kind, ordinal, record } of expected) {
      const key = `${kind}:${ordinal}`;
      const annotations = annotationGroups.get(key) ?? [];
      const relevance: SubmissionRelevance | null = annotations.length === 1
        ? annotations[0]!.relevance
        : null;
      const physicalBindings = annotations.length === 1 ? annotations[0]!.bindings : null;
      let reason: string | null = annotations.length === 0
        ? "missing_annotation"
        : annotations.length > 1 ? "duplicate_annotation" : null;
      if (!reason && physicalBindings === null) reason = "legacy_unbound_citation";
      if (!reason && batch.binding.prompt_injection_tainted) reason = "prompt_injection";
      if (!reason && citations(record).length > MAX_MODEL_CITATIONS_PER_ANNOTATED_RECORD) {
        reason = "record_citation_capacity";
      }
      let sourceBinding: RecordSourceBinding = "unlocated";
      let semanticCrosscheck: RecordSemanticCrosscheck = "unknown";
      const wholeBidChannels = new Set<SubmissionChannelSignature>();
      const citationBindings: RecordAuthorityCitationBinding[] = [];
      const selectedSourceSpans: OriginRecord["selectedSourceSpans"] = [];
      if (!reason) {
        if (citations(record).length === 0) reason = "missing_exact_citation";
        if (!reason && (physicalBindings?.length !== citations(record).length ||
          new Set(physicalBindings.map((binding) => binding.citation_ordinal)).size !==
            physicalBindings.length)) {
          reason = "invalid_private_source_binding";
        }
        for (const [citationOrdinal, citation] of citations(record).entries()) {
          if (reason) break;
          if (citation.document_sha256 !== record.document_sha256) {
            sourceBinding = "unlocated";
            reason = "cross_document_citation";
            break;
          }
          const matchingBindings = physicalBindings!.filter((binding) =>
            binding.citation_ordinal === citationOrdinal
          );
          const binding = matchingBindings[0];
          const document = input.documents.find((item) =>
            item.index.documentSha256 === citation.document_sha256
          );
          const page = document?.index.pages.find((item) =>
            item.pdfPage1Based === binding?.pdf_page_1based
          );
          const selectorValid = Boolean(binding &&
            binding.selector_end_utf16 > binding.selector_start_utf16 &&
            binding.evidence_end_utf16 > binding.evidence_start_utf16 &&
            batch.sourceMap?.fragments.get(binding.source_fragment_id) &&
            sourceOriginCommitted(
              batch,
              input.ledger,
              batch.sourceMap.fragments.get(binding.source_fragment_id)!
            ));
          const reResolved = selectorValid && batch.sourceMap
            ? resolveSemanticSpan(batch.sourceMap, {
                source_fragment_id: binding!.source_fragment_id,
                start_utf16: binding!.selector_start_utf16,
                length_utf16: binding!.selector_end_utf16 - binding!.selector_start_utf16
              }, input.documents)
            : null;
          const expectedBinding = reResolved && {
            citation_ordinal: citationOrdinal,
            ...reResolved.binding
          };
          const physicalValid = Boolean(selectorValid && page && reResolved && expectedBinding &&
            stableJson(binding) === stableJson(expectedBinding) &&
            reResolved.evidence_quote === citation.evidence_quote &&
            binding!.document_sha256 === citation.document_sha256 &&
            binding!.document_sha256 === record.document_sha256 &&
            binding!.page_text_sha256 === sha256Hex(page!.text) &&
            binding!.evidence_quote_sha256 === sha256Hex(citation.evidence_quote) &&
            binding!.evidence_end_utf16 <= page!.text.length &&
            page!.text.slice(binding!.evidence_start_utf16, binding!.evidence_end_utf16) ===
              citation.evidence_quote);
          if (!physicalValid) {
            sourceBinding = "unlocated";
            reason = "invalid_private_source_binding";
            break;
          }
          const sourceFragment = batch.sourceMap!.fragments.get(binding!.source_fragment_id)!;
          selectedSourceSpans.push({
            citationOrdinal,
            sourceText: sourceFragment.source_text.slice(
              binding!.selector_start_utf16,
              binding!.selector_end_utf16
            ),
            evidenceQuote: citation.evidence_quote
          });
          const start = binding!.evidence_start_utf16;
          const end = binding!.evidence_end_utf16;
          const midpoint = start + Math.floor((end - start - 1) / 2);
          const candidateIds = input.ledger.candidates.filter((candidate) =>
            candidate.document_sha256 === binding!.document_sha256 &&
            candidate.pdf_page_1based === binding!.pdf_page_1based &&
            midpoint >= candidate.core_start_utf16 && midpoint < candidate.core_end_utf16 &&
            start >= candidate.source_start_utf16 && end <= candidate.source_end_utf16
          ).map((candidate) => candidate.candidate_id);
          const occurrences = [{
            documentSha256: binding!.document_sha256,
            page: binding!.pdf_page_1based,
            start,
            end,
            candidateIds
          }];
          const occurrenceStates = occurrences.map((occurrence) => {
            const coverage = occurrence.candidateIds.map((id) => verifiedCoverage.get(id))
              .filter((value) => value?.disposition === "verified");
            if (coverage.length === 0) return { covered: false, overlaps: [] as NonNullable<typeof coverage[0]>["relations"] };
            const overlaps = coverage.flatMap((record) => record!.relations.filter((relation) =>
              relation.document_sha256 === occurrence.documentSha256 &&
              relation.pdf_page_1based === occurrence.page &&
              relation.relation_start_utf16 < occurrence.end &&
              relation.relation_end_utf16 > occurrence.start
            ));
            return { covered: true, overlaps };
          });
          citationBindings.push({
            document_sha256: citation.document_sha256,
            evidence_quote_sha256: sha256Hex(citation.evidence_quote),
            occurrences: occurrenceStates.map((state, index) => ({
              pdf_page_1based: occurrences[index]!.page,
              start_utf16: occurrences[index]!.start,
              end_utf16: occurrences[index]!.end,
              candidate_ids: [...occurrences[index]!.candidateIds].toSorted(),
              relation_binding_digests: state.overlaps.map((relation) =>
                sha256Hex(stableJson(relation))
              ).toSorted()
            }))
          });
          if (occurrenceStates.some((state) => !state.covered)) {
            sourceBinding = "coverage_gap";
            if (relevance === "s") semanticCrosscheck = "disagrees";
            reason = "incomplete_occurrence_coverage";
            break;
          }
          sourceBinding = "exact_bound";
          for (const relation of occurrenceStates.flatMap((state) => state.overlaps)) {
            if (relation.subject_scope === "whole_bid" && relation.channel !== "unspecified") {
              wholeBidChannels.add(relation.channel);
            }
          }
          const ambiguous = occurrenceStates.some((state) => state.overlaps.some((relation) =>
            relation.subject_scope === "ambiguous" || relation.modality === "unknown" ||
            relation.channel === "unspecified"
          ));
          const nonSubmissionChannelConflict = occurrenceStates.some((state) =>
            state.overlaps.some((relation) =>
              relation.channel !== "unspecified" &&
              (relation.subject_scope === "whole_bid" || relation.subject_scope === "ambiguous")
            )
          );
          if (relevance === "s") {
            const compatible = occurrenceStates.every((state) => state.overlaps.some((relation) =>
              relation.subject_scope === "whole_bid" && relation.modality !== "unknown" &&
              relation.channel !== "unspecified"
            ));
            if (occurrenceStates.some((state) => state.overlaps.length === 0)) {
              sourceBinding = "relation_gap";
              semanticCrosscheck = "disagrees";
              reason = "relationless_submission_record";
              break;
            }
            if (!compatible || ambiguous) {
              sourceBinding = "relation_conflict";
              semanticCrosscheck = "disagrees";
              reason = "submission_relation_conflict";
              break;
            }
          } else if (relevance === "n" && nonSubmissionChannelConflict) {
            sourceBinding = "relation_conflict";
            semanticCrosscheck = "disagrees";
            reason = "non_submission_relation_overlap";
            break;
          } else if (relevance === "u") {
            semanticCrosscheck = "disagrees";
            reason = "semantic_uncertainty";
            break;
          }
        }
      }
      if (!reason && sourceBinding === "exact_bound") semanticCrosscheck = "consistent";
      const originKey = sha256Hex(stableJson({
        authority_version: RECORD_AUTHORITY_VERSION,
        batch_id: batch.binding.batch_id,
        record_kind: kind,
        array_ordinal: ordinal,
        canonical_public_record: canonicalModelRecord(kind, record)
      }));
      const publication: RecordPublication = !reason && sourceBinding === "exact_bound" &&
        semanticCrosscheck === "consistent" ? "verified" : "discarded";
      origins.push({
        originKey,
        kind,
        ordinal,
        record,
        binding: batch.binding,
        relevance,
        sourceBinding,
        semanticCrosscheck,
        publication,
        reason,
        wholeBidChannels,
        citationBindings,
        selectedSourceSpans
      });
      if (reason) discardedReasons.push(reason);
      if (semanticCrosscheck === "disagrees") submissionVetoReasons.push(reason ?? "semantic_disagreement");
    }
  }

  const originToMerged = mergedIds(origins);
  const joinedGroups = new Map<string, OriginRecord[]>();
  for (const origin of origins) {
    const mergedId = originToMerged.get(origin.originKey);
    if (!mergedId) {
      receiptReasons.push("lost_origin");
      continue;
    }
    const key = `${origin.kind}:${mergedId}`;
    joinedGroups.set(key, [...(joinedGroups.get(key) ?? []), origin]);
  }
  const joined: JoinedRecordAuthority[] = [];
  for (const [key, group] of joinedGroups) {
    const [kind, ...idParts] = key.split(":");
    const relevances = new Set(group.flatMap((origin) => origin.relevance ?? []));
    const allExact = group.every((origin) => origin.sourceBinding !== "unlocated" &&
      origin.sourceBinding !== "coverage_gap");
    let reason = group.find((origin) => origin.reason)?.reason ?? null;
    let semanticCrosscheck: RecordSemanticCrosscheck = group.some((origin) =>
      origin.semanticCrosscheck === "disagrees"
    ) ? "disagrees" : group.some((origin) => origin.semanticCrosscheck === "unknown")
      ? "unknown" : "consistent";
    if (relevances.size !== 1) {
      reason = "duplicate_record_relevance_disagreement";
      semanticCrosscheck = allExact ? "disagrees" : "unknown";
      discardedReasons.push(reason);
      if (allExact) submissionVetoReasons.push(reason);
    }
    const relevance = relevances.size === 1 ? [...relevances][0]! : null;
    const sourceBinding = group.map((origin) => origin.sourceBinding).toSorted((left, right) =>
      sourceBindingRank(right) - sourceBindingRank(left)
    )[0] ?? "unlocated";
    const publication: RecordPublication = group.every((origin) => origin.publication === "verified") &&
      relevances.size === 1 && semanticCrosscheck === "consistent"
      ? "verified"
      : "discarded";
    const channels = new Set(group.flatMap((origin) => [...origin.wholeBidChannels]));
    joined.push({
      merged_record_id: idParts.join(":"),
      canonical_record_digest: canonicalModelRecordDigest(kind as RecordKind, group[0]!.record),
      kind: kind as RecordKind,
      relevance,
      source_binding: sourceBinding,
      semantic_crosscheck: semanticCrosscheck,
      publication,
      reason,
      contributing_origin_record_keys: group.map((origin) => origin.originKey),
      whole_bid_channels: [...channels].toSorted()
    });
  }
  if (input.mergedDraft) {
    const expectedMergedRecords = recordsIn(input.mergedDraft).map(({ kind, record }) =>
      `${kind}:${publicRecordId(kind, record)}:${canonicalModelRecordDigest(kind, record)}`
    );
    const actualMergedRecords = joined.map((record) =>
      `${record.kind}:${record.merged_record_id}:${record.canonical_record_digest}`
    );
    if (new Set(expectedMergedRecords).size !== expectedMergedRecords.length ||
      new Set(actualMergedRecords).size !== actualMergedRecords.length ||
      stableJson(expectedMergedRecords.toSorted()) !== stableJson(actualMergedRecords.toSorted())) {
      receiptReasons.push("merged_record_mapping_mismatch");
    }
  }
  const complete = receiptReasons.length === 0 &&
    origins.length === joined.reduce(
      (count, record) => count + record.contributing_origin_record_keys.length,
      0
    );
  const verifiedOrigins: VerifiedOriginRecordAuthority[] = origins.flatMap((origin) => {
    const mergedRecordId = originToMerged.get(origin.originKey);
    return mergedRecordId ? [{
      origin_record_key: origin.originKey,
      batch_id: origin.binding.batch_id,
      kind: origin.kind,
      ordinal: origin.ordinal,
      relevance: origin.relevance,
      canonical_record_digest: canonicalModelRecordDigest(origin.kind, origin.record),
      merged_record_id: mergedRecordId,
      source_binding: origin.sourceBinding,
      semantic_crosscheck: origin.semanticCrosscheck,
      publication: complete ? origin.publication : "discarded",
      reason: origin.reason,
      citation_bindings: origin.citationBindings
    }] : [];
  });
  const safeJoined = complete ? joined : joined.map((record) => ({
    ...record,
    publication: "discarded" as const,
    semantic_crosscheck: "unknown" as const,
    reason: record.reason ?? receiptReasons[0] ?? "record_authority_integrity"
  }));
  const uniqueReasons = [...new Set([...receiptReasons, ...submissionVetoReasons])];
  const manifestWithoutDigest: UnsealedRecordAuthorityManifest = {
    version: RECORD_AUTHORITY_VERSION,
    complete,
    package_veto: complete && safeJoined.some((record) =>
      record.semantic_crosscheck === "disagrees"
    ),
    unresolved_reasons: uniqueReasons,
    discarded_reasons: [...new Set(discardedReasons)],
    origin_record_key_to_merged_record_id: Object.fromEntries(originToMerged),
    origins: verifiedOrigins,
    records: safeJoined
  };
  const sealed = sealRecordAuthorityManifest(manifestWithoutDigest);
  if (!recordAuthorityReceiptWithinCapacity(sealed.receipt_byte_length)) {
    return unresolvedRecordAuthority("record_authority_receipt_capacity");
  }
  attachAuthenticatedPresentationSidecar(sealed, joinedGroups);
  return sealed;
}

export function unresolvedRecordAuthority(reason: string): VerifiedRecordAuthorityManifest {
  const manifestWithoutDigest: UnsealedRecordAuthorityManifest = {
    version: RECORD_AUTHORITY_VERSION,
    complete: false,
    package_veto: false,
    unresolved_reasons: [reason],
    discarded_reasons: [],
    origin_record_key_to_merged_record_id: {},
    origins: [],
    records: []
  };
  return sealRecordAuthorityManifest(manifestWithoutDigest);
}

export function recordAuthorityManifestMatchesDraft(
  input: VerifiedRecordAuthorityManifest,
  draft: DraftAnalysis
) {
  if (!recordAuthorityManifestIntegrity(input)) return false;
  const expected = recordsIn(draft).map(({ kind, record }) =>
    `${kind}:${publicRecordId(kind, record)}:${canonicalModelRecordDigest(kind, record)}`
  );
  const actual = input.records.map((record) =>
    `${record.kind}:${record.merged_record_id}:${record.canonical_record_digest}`
  );
  return expected.length === actual.length &&
    new Set(expected).size === expected.length &&
    new Set(actual).size === actual.length &&
    stableJson(expected.toSorted()) === stableJson(actual.toSorted());
}
