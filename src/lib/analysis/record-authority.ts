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

export const RECORD_AUTHORITY_ENVELOPE_VERSION = 1 as const;
export const RECORD_AUTHORITY_VERSION = 3 as const;
// T10 carries relevance inline on every private model record. This bound is the
// sum of the strict private Draft collection maxima and is a server-only guard;
// it is no longer a positional provider sidecar or a 40-record delivery limit.
export const MAX_RECORD_AUTHORITY_RECORDS_PER_BATCH = 2_600;
export const MAX_MODEL_CITATIONS_PER_ANNOTATED_RECORD = 3;
export const MAX_EXACT_OCCURRENCES_PER_CITATION = 8;
export const MAX_RECORD_AUTHORITY_RECEIPT_BYTES = 262_144;

export const RecordAuthorityEnvelopeSchema = z.object({
  v: z.literal(RECORD_AUTHORITY_ENVELOPE_VERSION),
  r: z.array(z.tuple([
    z.enum(["c", "q", "r", "e"]),
    z.number().int().nonnegative(),
    z.enum(["s", "n", "u"])
  ])).max(MAX_RECORD_AUTHORITY_RECORDS_PER_BATCH)
});

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
export type RecordAuthorityEnvelope = z.infer<typeof RecordAuthorityEnvelopeSchema>;

export type ModelRecord =
  | DraftAnalysis["claims"][number]
  | DraftAnalysis["requirements"][number]
  | DraftAnalysis["risks"][number]
  | DraftAnalysis["evaluation"]["rules"][number];

export interface RecordAuthorityBatch {
  binding: SubmissionBatchBinding;
  draft: DraftAnalysis;
  authority: RecordAuthorityEnvelope;
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
      .map(({ kind, ordinal }) => [kind, ordinal, "u"])
  });
}

function exactOccurrences(
  quote: string,
  documentSha256: string,
  documents: CitationDocument[],
  ledger: SubmissionCandidateLedger
) {
  const occurrences = new Map<string, {
    documentSha256: string;
    page: number;
    start: number;
    end: number;
    candidateIds: string[];
  }>();
  const document = documents.find((item) => item.index.documentSha256 === documentSha256);
  if (!document) return [];
  for (const page of document.index.pages) {
    let cursor = 0;
    while (cursor <= page.text.length) {
      const localStart = page.text.indexOf(quote, cursor);
      if (localStart < 0) break;
      const start = localStart;
      const end = start + quote.length;
      const midpoint = start + Math.floor((quote.length - 1) / 2);
      const candidateIds = ledger.candidates.filter((candidate) =>
        candidate.document_sha256 === documentSha256 &&
        candidate.pdf_page_1based === page.pdfPage1Based &&
        midpoint >= candidate.core_start_utf16 && midpoint < candidate.core_end_utf16 &&
        start >= candidate.source_start_utf16 && end <= candidate.source_end_utf16
      ).map((candidate) => candidate.candidate_id);
      const key = `${documentSha256}:${page.pdfPage1Based}:${start}:${end}`;
      occurrences.set(key, {
        documentSha256,
        page: page.pdfPage1Based,
        start,
        end,
        candidateIds
      });
      cursor = localStart + Math.max(1, quote.length);
    }
  }
  return [...occurrences.values()];
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
    const annotationGroups = new Map<string, SubmissionRelevance[]>();
    for (const [kind, ordinal, relevance] of batch.authority.r) {
      const key = `${kind}:${ordinal}`;
      annotationGroups.set(key, [...(annotationGroups.get(key) ?? []), relevance]);
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
      const relevance: SubmissionRelevance | null = annotations.length === 1 ? annotations[0] : null;
      let reason: string | null = annotations.length === 0
        ? "missing_annotation"
        : annotations.length > 1 ? "duplicate_annotation" : null;
      if (!reason && batch.binding.prompt_injection_tainted) reason = "prompt_injection";
      if (!reason && citations(record).length > MAX_MODEL_CITATIONS_PER_ANNOTATED_RECORD) {
        reason = "record_citation_capacity";
      }
      let sourceBinding: RecordSourceBinding = "unlocated";
      let semanticCrosscheck: RecordSemanticCrosscheck = "unknown";
      const wholeBidChannels = new Set<SubmissionChannelSignature>();
      const citationBindings: RecordAuthorityCitationBinding[] = [];
      if (!reason) {
        if (citations(record).length === 0) reason = "missing_exact_citation";
        for (const citation of citations(record)) {
          if (reason) break;
          if (citation.document_sha256 !== record.document_sha256) {
            sourceBinding = "unlocated";
            reason = "cross_document_citation";
            break;
          }
          const occurrences = exactOccurrences(
            citation.evidence_quote,
            citation.document_sha256,
            input.documents,
            input.ledger
          );
          if (occurrences.length === 0) {
            sourceBinding = "unlocated";
            reason = "non_exact_or_uncovered_citation";
            break;
          }
          if (occurrences.length > MAX_EXACT_OCCURRENCES_PER_CITATION) {
            sourceBinding = "unlocated";
            reason = "exact_occurrence_capacity";
            break;
          }
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
          const wholeBidOverlap = occurrenceStates.some((state) => state.overlaps.some((relation) =>
            relation.subject_scope === "whole_bid"
          ));
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
          } else if (relevance === "n" && (wholeBidOverlap || ambiguous)) {
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
        citationBindings
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
  return recordAuthorityReceiptWithinCapacity(sealed.receipt_byte_length)
    ? sealed
    : unresolvedRecordAuthority("record_authority_receipt_capacity");
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
