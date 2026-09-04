import { z } from "zod";
import {
  MAX_RECORD_AUTHORITY_RECEIPT_BYTES,
  RECORD_AUTHORITY_PUBLICATION_REASON_KEYS,
  RECORD_AUTHORITY_SUBMISSION_VETO_REASON_KEYS,
  recordAuthorityDiagnosticCounters,
  recordAuthorityManifestIntegrity,
  unresolvedRecordAuthority,
  type VerifiedRecordAuthorityManifest
} from "@/lib/analysis/record-authority";

const CounterSchema = z.number().int().nonnegative().max(10_000);
export const RECORD_AUTHORITY_AUDIT_VERSION = 4 as const;
const LegacyRecordAuthorityAuditSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  manifest_digest: z.string().regex(/^[a-f0-9]{64}$/),
  receipt_byte_length: z.number().int().nonnegative()
    .max(MAX_RECORD_AUTHORITY_RECEIPT_BYTES),
  receipt_limit_bytes: z.literal(MAX_RECORD_AUTHORITY_RECEIPT_BYTES),
  record_count: z.number().int().nonnegative(),
  complete: z.boolean(),
  recorded_at: z.string().datetime({ offset: true })
}).strict();

const fixedCounterObject = <T extends readonly string[]>(keys: T) => z.object(
  Object.fromEntries(keys.map((key) => [key, CounterSchema])) as Record<T[number], typeof CounterSchema>
).strict();

const Version3RecordAuthorityAuditSchema = z.object({
    version: z.literal(3),
    manifest_digest: z.string().regex(/^[a-f0-9]{64}$/),
    receipt_byte_length: z.number().int().nonnegative().max(MAX_RECORD_AUTHORITY_RECEIPT_BYTES),
    receipt_limit_bytes: z.literal(MAX_RECORD_AUTHORITY_RECEIPT_BYTES),
    record_count: z.number().int().nonnegative().max(10_000),
    complete: z.boolean(),
    recorded_at: z.string().datetime({ offset: true }),
    counters: z.object({
      relevance: z.object({ s: CounterSchema, n: CounterSchema, u: CounterSchema,
        missing: CounterSchema }).strict(),
      source_binding: z.object({ unlocated: CounterSchema, exact_bound: CounterSchema,
        coverage_gap: CounterSchema, relation_gap: CounterSchema,
        relation_conflict: CounterSchema }).strict(),
      semantic_crosscheck: z.object({ consistent: CounterSchema, disagrees: CounterSchema,
        unknown: CounterSchema }).strict(),
      publication: z.object({ verified: CounterSchema, discarded: CounterSchema }).strict(),
      publication_reason: fixedCounterObject(RECORD_AUTHORITY_PUBLICATION_REASON_KEYS),
      submission_veto_reason: fixedCounterObject(RECORD_AUTHORITY_SUBMISSION_VETO_REASON_KEYS)
    }).strict()
  }).strict().superRefine((audit, context) => {
    const recordAxes = [audit.counters.relevance, audit.counters.source_binding,
      audit.counters.semantic_crosscheck, audit.counters.publication,
      audit.counters.publication_reason];
    if (recordAxes.some((axis) => Object.values(axis).reduce((sum, value) => sum + value, 0) !==
      audit.record_count)) {
      context.addIssue({ code: "custom", message: "record_authority_counter_mismatch" });
    }
    if (Object.values(audit.counters.submission_veto_reason)
      .reduce((sum, value) => sum + value, 0) > audit.record_count) {
      context.addIssue({ code: "custom", message: "record_authority_veto_counter_mismatch" });
    }
  });

const CurrentRecordAuthorityAuditSchema = z.object({
    version: z.literal(RECORD_AUTHORITY_AUDIT_VERSION),
    manifest_digest: z.string().regex(/^[a-f0-9]{64}$/),
    receipt_byte_length: z.number().int().nonnegative().max(MAX_RECORD_AUTHORITY_RECEIPT_BYTES),
    receipt_limit_bytes: z.literal(MAX_RECORD_AUTHORITY_RECEIPT_BYTES),
    record_count: z.number().int().nonnegative().max(10_000),
    complete: z.boolean(),
    integrity_complete: z.boolean(),
    package_veto: z.boolean(),
    recorded_at: z.string().datetime({ offset: true }),
    counters: z.object({
      relevance: z.object({ s: CounterSchema, n: CounterSchema, u: CounterSchema,
        mixed: CounterSchema, missing: CounterSchema }).strict(),
      source_binding: z.object({ unlocated: CounterSchema, exact_bound: CounterSchema,
        coverage_gap: CounterSchema, relation_gap: CounterSchema,
        relation_conflict: CounterSchema }).strict(),
      semantic_crosscheck: z.object({ consistent: CounterSchema, disagrees: CounterSchema,
        unknown: CounterSchema }).strict(),
      publication: z.object({ verified: CounterSchema, discarded: CounterSchema }).strict(),
      publication_reason: fixedCounterObject(RECORD_AUTHORITY_PUBLICATION_REASON_KEYS),
      submission_veto_reason: fixedCounterObject(RECORD_AUTHORITY_SUBMISSION_VETO_REASON_KEYS)
    }).strict()
  }).strict().superRefine((audit, context) => {
    const recordAxes = [audit.counters.relevance, audit.counters.source_binding,
      audit.counters.semantic_crosscheck, audit.counters.publication,
      audit.counters.publication_reason];
    if (recordAxes.some((axis) => Object.values(axis).reduce((sum, value) => sum + value, 0) !==
      audit.record_count)) {
      context.addIssue({ code: "custom", message: "record_authority_counter_mismatch" });
    }
    if (Object.values(audit.counters.submission_veto_reason)
      .reduce((sum, value) => sum + value, 0) > audit.record_count) {
      context.addIssue({ code: "custom", message: "record_authority_veto_counter_mismatch" });
    }
    if (audit.complete !== (audit.integrity_complete && !audit.package_veto)) {
      context.addIssue({ code: "custom", message: "record_authority_completeness_mismatch" });
    }
  });

export const RecordAuthorityAuditSchema = z.union([
  LegacyRecordAuthorityAuditSchema,
  Version3RecordAuthorityAuditSchema,
  CurrentRecordAuthorityAuditSchema
]);

export type RecordAuthorityAudit = z.infer<typeof RecordAuthorityAuditSchema>;

/**
 * Persist only the bounded server receipt measurements and its integrity
 * digest. Never persist the receipt, source evidence, or model output here.
 */
export function createRecordAuthorityAudit(
  manifest: VerifiedRecordAuthorityManifest | null | undefined,
  recordedAt = new Date()
): RecordAuthorityAudit {
  const verified = manifest && recordAuthorityManifestIntegrity(manifest)
    ? manifest
    : unresolvedRecordAuthority(manifest
      ? "unverified_record_authority_audit"
      : "missing_record_authority_audit");
  return RecordAuthorityAuditSchema.parse({
    version: RECORD_AUTHORITY_AUDIT_VERSION,
    manifest_digest: verified.record_manifest_digest,
    receipt_byte_length: verified.receipt_byte_length,
    receipt_limit_bytes: verified.receipt_capacity_bytes,
    record_count: verified.records.length,
    complete: verified.complete && !verified.package_veto,
    integrity_complete: verified.complete,
    package_veto: verified.package_veto,
    recorded_at: recordedAt.toISOString(),
    counters: recordAuthorityDiagnosticCounters(verified)
  });
}
