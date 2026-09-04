import { z } from "zod";
import {
  SUBMISSION_UNRESOLVED_REASON_KEYS,
  resolveVerifiedSubmissionChannel,
  type SubmissionUnresolvedReason,
  type VerifiedSubmissionAdjudication
} from "@/lib/analysis/submission-channel";

export const SUBMISSION_ADJUDICATION_AUDIT_VERSION = 2 as const;
const CounterSchema = z.number().int().nonnegative().max(10_000);
const VERSION_1_REASON_KEYS = SUBMISSION_UNRESOLVED_REASON_KEYS.filter(
  (reason) => reason !== "ownership_mismatch"
);
const fixedReasonCounters = <T extends readonly SubmissionUnresolvedReason[]>(keys: T) => z.object(
  Object.fromEntries(keys.map((reason) => [reason, CounterSchema])) as
    Record<T[number], typeof CounterSchema>
).strict();

const commonAuditFields = {
  ledger_digest: z.string().regex(/^[a-f0-9]{64}$/),
  expected_candidate_count: CounterSchema,
  verified_candidate_count: CounterSchema,
  expected_page_count: CounterSchema,
  covered_page_count: CounterSchema,
  expected_source_fragment_count: CounterSchema,
  verified_source_fragment_count: CounterSchema,
  expected_batch_count: CounterSchema,
  verified_batch_count: CounterSchema,
  unresolved_batch_count: CounterSchema,
  complete: z.boolean(),
  resolution_status: z.enum([
    "unique", "none", "possible_only", "multiple", "contradicted", "unresolved"
  ]),
  recorded_at: z.string().datetime({ offset: true })
};

function auditConsistency<T extends {
  expected_candidate_count: number;
  verified_candidate_count: number;
  expected_page_count: number;
  covered_page_count: number;
  expected_source_fragment_count: number;
  verified_source_fragment_count: number;
  expected_batch_count: number;
  verified_batch_count: number;
  unresolved_batch_count: number;
  complete: boolean;
  unresolved_reason_counts: Record<string, number>;
}>(audit: T, context: z.RefinementCtx) {
  if (audit.verified_candidate_count > audit.expected_candidate_count ||
    audit.covered_page_count > audit.expected_page_count ||
    audit.verified_source_fragment_count > audit.expected_source_fragment_count ||
    audit.verified_batch_count > audit.expected_batch_count ||
    audit.unresolved_batch_count !== audit.expected_batch_count - audit.verified_batch_count) {
    context.addIssue({ code: "custom", message: "submission_adjudication_audit_count_mismatch" });
  }
  const reasonTotal = Object.values(audit.unresolved_reason_counts)
    .reduce((sum, count) => sum + count, 0);
  if (audit.complete !== (reasonTotal === 0 &&
    audit.verified_candidate_count === audit.expected_candidate_count &&
    audit.covered_page_count === audit.expected_page_count &&
    audit.verified_source_fragment_count === audit.expected_source_fragment_count &&
    audit.verified_batch_count === audit.expected_batch_count)) {
    context.addIssue({ code: "custom", message: "submission_adjudication_audit_completeness_mismatch" });
  }
}

const Version1SubmissionAdjudicationAuditSchema = z.object({
  version: z.literal(1),
  ...commonAuditFields,
  unresolved_reason_counts: fixedReasonCounters(VERSION_1_REASON_KEYS)
}).strict().superRefine(auditConsistency);

const CurrentSubmissionAdjudicationAuditSchema = z.object({
  version: z.literal(SUBMISSION_ADJUDICATION_AUDIT_VERSION),
  ...commonAuditFields,
  unresolved_reason_counts: fixedReasonCounters(SUBMISSION_UNRESOLVED_REASON_KEYS)
}).strict().superRefine(auditConsistency);

export const SubmissionAdjudicationAuditSchema = z.union([
  Version1SubmissionAdjudicationAuditSchema,
  CurrentSubmissionAdjudicationAuditSchema
]);

export type SubmissionAdjudicationAudit = z.infer<typeof SubmissionAdjudicationAuditSchema>;

function reasonCounts(artifact: VerifiedSubmissionAdjudication) {
  const counts = Object.fromEntries(SUBMISSION_UNRESOLVED_REASON_KEYS.map((reason) => [reason, 0])) as
    Record<SubmissionUnresolvedReason, number>;
  for (const record of artifact.records) {
    if (record.reason) counts[record.reason] += 1;
  }
  // Some failures are global and have no candidate record. Preserve their
  // bounded presence without persisting a batch, candidate, page, or source ID.
  for (const reason of artifact.unresolved_reasons) {
    if (counts[reason] === 0) counts[reason] = 1;
  }
  return counts;
}

export function createSubmissionAdjudicationAudit(
  artifact: VerifiedSubmissionAdjudication,
  recordedAt = new Date()
): SubmissionAdjudicationAudit {
  const counts = reasonCounts(artifact);
  return SubmissionAdjudicationAuditSchema.parse({
    version: SUBMISSION_ADJUDICATION_AUDIT_VERSION,
    ledger_digest: artifact.ledger_digest,
    expected_candidate_count: artifact.expected_candidate_count,
    verified_candidate_count: artifact.verified_candidate_count,
    expected_page_count: artifact.expected_page_count,
    covered_page_count: artifact.covered_page_count,
    expected_source_fragment_count: artifact.expected_source_fragment_count,
    verified_source_fragment_count: artifact.verified_source_fragment_count,
    expected_batch_count: artifact.expected_batch_count,
    verified_batch_count: artifact.verified_batch_count,
    unresolved_batch_count: artifact.expected_batch_count - artifact.verified_batch_count,
    complete: artifact.complete,
    resolution_status: resolveVerifiedSubmissionChannel(artifact).status,
    unresolved_reason_counts: counts,
    recorded_at: recordedAt.toISOString()
  });
}
