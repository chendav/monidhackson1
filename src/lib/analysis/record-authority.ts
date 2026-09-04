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
export const RECORD_AUTHORITY_VERSION = 2 as const;
export const MAX_RECORD_AUTHORITY_ANNOTATIONS_PER_BATCH = 40;
export const MAX_MODEL_CITATIONS_PER_ANNOTATED_RECORD = 3;
export const MAX_EXACT_OCCURRENCES_PER_CITATION = 8;
export const MAX_RECORD_AUTHORITY_RECEIPT_BYTES = 262_144;

export const RecordAuthorityEnvelopeSchema = z.object({
  v: z.literal(RECORD_AUTHORITY_ENVELOPE_VERSION),
  r: z.array(z.tuple([
    z.enum(["c", "q", "r", "e"]),
    z.number().int().nonnegative(),
    z.enum(["s", "n", "u"])
  ])).max(MAX_RECORD_AUTHORITY_ANNOTATIONS_PER_BATCH)
});

export type RecordKind = "c" | "q" | "r" | "e";
export type SubmissionRelevance = "s" | "n" | "u";
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
  relevance: SubmissionRelevance;
  disposition: "verified" | "discarded" | "unresolved";
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
  disposition: "verified" | "discarded" | "unresolved";
  reason: string | null;
  citation_bindings: RecordAuthorityCitationBinding[];
}

export interface VerifiedRecordAuthorityManifest {
  version: 1 | typeof RECORD_AUTHORITY_VERSION;
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
  // Version 1 coupled every publication miss to a package-wide veto. It is
  // intentionally accepted by the TypeScript boundary only so old receipts
  // can be rejected deterministically instead of being guessed forward.
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
  return input.receipt_capacity_bytes === MAX_RECORD_AUTHORITY_RECEIPT_BYTES &&
    input.receipt_byte_length === receiptBytes && receiptBytes <= MAX_RECORD_AUTHORITY_RECEIPT_BYTES &&
    input.record_manifest_digest === verifiedRecordAuthorityManifestDigest(input) &&
    new Set(originKeys).size === originKeys.length &&
    originKeys.length === contributorKeys.length &&
    new Set(contributorKeys).size === contributorKeys.length &&
    new Set(mappingKeys).size === mappingKeys.length &&
    contributorKeys.length === mappingKeys.length &&
    input.package_veto === (!input.complete || input.records.some((record) =>
      record.disposition === "unresolved" || record.relevance === "u"
    )) && input.records.every((record) =>
      record.disposition !== "discarded" || record.relevance === "n"
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
  disposition: "verified" | "discarded" | "unresolved";
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
    r: recordsIn(draft).slice(0, MAX_RECORD_AUTHORITY_ANNOTATIONS_PER_BATCH)
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
      const candidateIds = ledger.candidates.filter((candidate) =>
        candidate.document_sha256 === documentSha256 &&
        candidate.pdf_page_1based === page.pdfPage1Based &&
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
    const plan = new Map(planCanonicalRecordMerge(
      kind,
      [...groups.values()].map((group) => group[0]!.record)
    ).map((item) => [item.canonicalSerialization, item]));
    for (const [canonical, group] of groups) {
      const mergedId = plan.get(canonical)?.mergedId;
      if (!mergedId) continue;
      for (const origin of group) result.set(origin.originKey, mergedId);
    }
  }
  return result;
}

// These failures concern whether an exactly-once, canonical-bound `n` record
// may be published. The Agent has already stated that the record is unrelated
// to submission method, so omitting it is safe. Semantic/structural failures
// (including relation overlap and every capacity/integrity failure) are not in
// this set and retain the package-wide veto.
const DISCARDABLE_NON_SUBMISSION_PUBLICATION_FAILURES = new Set([
  "missing_exact_citation",
  "cross_document_citation",
  "non_exact_or_uncovered_citation",
  "incomplete_occurrence_coverage"
]);

export function verifyRecordAuthorities(input: {
  batches: RecordAuthorityBatch[];
  ledger: SubmissionCandidateLedger;
  submission: VerifiedSubmissionAdjudication;
  documents: CitationDocument[];
  /** Exact result of the same merge operation that will be materialized. */
  mergedDraft?: DraftAnalysis;
}): VerifiedRecordAuthorityManifest {
  const origins: OriginRecord[] = [];
  const globalReasons: string[] = [];
  const discardedReasons: string[] = [];
  const verifiedCoverage = new Map(input.submission.records.map((record) => [record.candidate_id, record]));
  const knownBatchIds = new Set(input.batches.map((batch) => batch.binding.batch_id));
  if (knownBatchIds.size !== input.batches.length) globalReasons.push("duplicate_batch");

  for (const batch of input.batches) {
    const expected = recordsIn(batch.draft);
    const annotationGroups = new Map<string, SubmissionRelevance[]>();
    for (const [kind, ordinal, relevance] of batch.authority.r) {
      const key = `${kind}:${ordinal}`;
      annotationGroups.set(key, [...(annotationGroups.get(key) ?? []), relevance]);
    }
    const expectedKeys = new Set(expected.map(({ kind, ordinal }) => `${kind}:${ordinal}`));
    if (batch.authority.r.some(([kind, ordinal]) => !expectedKeys.has(`${kind}:${ordinal}`))) {
      globalReasons.push("unknown_annotation");
    }
    if (expected.length > MAX_RECORD_AUTHORITY_ANNOTATIONS_PER_BATCH) {
      globalReasons.push("record_authority_capacity");
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
      if (!reason && kind === "q" &&
        (record as DraftAnalysis["requirements"][number]).category === "submission" &&
        relevance === "n") {
        reason = "submission_requirement_marked_non_submission";
      }
      if (!reason && relevance === "u") reason = "semantic_uncertainty";

      const wholeBidChannels = new Set<SubmissionChannelSignature>();
      const citationBindings: RecordAuthorityCitationBinding[] = [];
      if (!reason) {
        if (citations(record).length === 0) reason = "missing_exact_citation";
        for (const citation of citations(record)) {
          if (reason) break;
          if (citation.document_sha256 !== record.document_sha256) {
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
            reason = "non_exact_or_uncovered_citation";
            break;
          }
          if (occurrences.length > MAX_EXACT_OCCURRENCES_PER_CITATION) {
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
            reason = "incomplete_occurrence_coverage";
            break;
          }
          if (relevance === "s" && occurrenceStates.some((state) => state.overlaps.length === 0)) {
            reason = "relationless_submission_record";
            break;
          }
          if (relevance === "n" && occurrenceStates.some((state) => state.overlaps.some((relation) =>
            relation.subject_scope === "whole_bid" || relation.subject_scope === "ambiguous" ||
            relation.modality === "unknown" || relation.channel === "unspecified"
          ))) {
            reason = "non_submission_relation_overlap";
            break;
          }
          const signatures = occurrenceStates.map((state) => stableJson(state.overlaps.map((relation) => ({
            subject_scope: relation.subject_scope,
            modality: relation.modality,
            channel: relation.channel
          })).toSorted((left, right) => stableJson(left).localeCompare(stableJson(right)))));
          if (new Set(signatures).size > 1) {
            reason = "duplicate_quote_mixed_matches";
            break;
          }
          for (const relation of occurrenceStates.flatMap((state) => state.overlaps)) {
            if (relation.subject_scope === "whole_bid" && relation.channel !== "unspecified") {
              wholeBidChannels.add(relation.channel);
            }
          }
        }
      }
      const originKey = sha256Hex(stableJson({
        authority_version: RECORD_AUTHORITY_VERSION,
        batch_id: batch.binding.batch_id,
        record_kind: kind,
        array_ordinal: ordinal,
        canonical_public_record: canonicalModelRecord(kind, record)
      }));
      const disposition = !reason
        ? "verified" as const
        : relevance === "n" &&
            DISCARDABLE_NON_SUBMISSION_PUBLICATION_FAILURES.has(reason)
          ? "discarded" as const
          : "unresolved" as const;
      origins.push({
        originKey,
        kind,
        ordinal,
        record,
        binding: batch.binding,
        relevance,
        disposition,
        reason,
        wholeBidChannels,
        citationBindings
      });
      if (reason) {
        (disposition === "discarded" ? discardedReasons : globalReasons).push(reason);
      }
    }
  }

  const originToMerged = mergedIds(origins);
  const joinedGroups = new Map<string, OriginRecord[]>();
  for (const origin of origins) {
    const mergedId = originToMerged.get(origin.originKey);
    if (!mergedId) {
      globalReasons.push("lost_origin");
      continue;
    }
    const key = `${origin.kind}:${mergedId}`;
    joinedGroups.set(key, [...(joinedGroups.get(key) ?? []), origin]);
  }
  const joined: JoinedRecordAuthority[] = [];
  for (const [key, group] of joinedGroups) {
    const [kind, ...idParts] = key.split(":");
    const relevances = new Set(group.flatMap((origin) => origin.relevance ?? []));
    let reason = relevances.size !== 1
      ? "duplicate_record_relevance_disagreement"
      : group.find((origin) => origin.disposition === "unresolved")?.reason ?? null;
    let disposition: JoinedRecordAuthority["disposition"] = reason
      ? "unresolved"
      : group.some((origin) => origin.disposition === "discarded")
        ? "discarded"
        : "verified";
    if (!reason && disposition === "discarded") {
      reason = group.find((origin) => origin.disposition === "discarded")?.reason ??
        "non_submission_publication_failure";
    }
    const relevance = relevances.has("s") ? "s" : relevances.has("u") ? "u" : "n";
    const channels = new Set(group.flatMap((origin) => [...origin.wholeBidChannels]));
    if (disposition === "verified" && relevance === "s" && channels.size === 0) {
      reason = "submission_record_without_whole_bid_relation";
      disposition = "unresolved";
    }
    if (reason) {
      (disposition === "discarded" ? discardedReasons : globalReasons).push(reason);
    }
    joined.push({
      merged_record_id: idParts.join(":"),
      canonical_record_digest: canonicalModelRecordDigest(kind as RecordKind, group[0]!.record),
      kind: kind as RecordKind,
      relevance,
      disposition,
      reason,
      contributing_origin_record_keys: group.map((origin) => origin.originKey),
      whole_bid_channels: [...channels].toSorted()
    });
  }
  const verifiedSubmissionRecords = joined.filter((record) =>
    record.relevance === "s" && record.disposition === "verified"
  );
  const submissionChannels = new Set(verifiedSubmissionRecords.flatMap((record) =>
    record.whole_bid_channels
  ));
  if (verifiedSubmissionRecords.length > 0 && submissionChannels.size !== 1) {
    globalReasons.push("submission_record_channel_disagreement");
  }
  const hasDraftSubmissionSummary = input.batches.some((batch) =>
    Boolean(batch.draft.summary.submission_method?.trim())
  );
  if (hasDraftSubmissionSummary && !verifiedSubmissionRecords.some((record) =>
    record.kind === "c" || record.kind === "q"
  )) {
    globalReasons.push("unmirrored_submission_summary");
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
      globalReasons.push("merged_record_mapping_mismatch");
    }
  }
  const uniqueReasons = [...new Set(globalReasons)];
  const complete = input.submission.complete && uniqueReasons.length === 0 &&
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
      disposition: origin.disposition,
      reason: origin.reason,
      citation_bindings: origin.citationBindings
    }] : [];
  });
  const manifestWithoutDigest: UnsealedRecordAuthorityManifest = {
    version: RECORD_AUTHORITY_VERSION,
    complete,
    package_veto: !complete || joined.some((record) => record.relevance === "u" ||
      record.disposition === "unresolved"),
    unresolved_reasons: uniqueReasons,
    discarded_reasons: [...new Set(discardedReasons)],
    origin_record_key_to_merged_record_id: Object.fromEntries(originToMerged),
    origins: verifiedOrigins,
    records: joined
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
    package_veto: true,
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
