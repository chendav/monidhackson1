import path from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

const LEGACY_RECEIPT_LIMIT_BYTES = 262_144;
const CURRENT_RECEIPT_LIMIT_BYTES = 524_288;

const CounterSchema = z.number().int().nonnegative().max(10_000);
const commonFields = (receiptLimitBytes) => ({
  manifest_digest: z.string().regex(/^[a-f0-9]{64}$/),
  receipt_byte_length: z.number().int().nonnegative().max(receiptLimitBytes),
  receipt_limit_bytes: z.literal(receiptLimitBytes),
  record_count: z.number().int().nonnegative().max(10_000),
  complete: z.boolean(),
  recorded_at: z.string().datetime({ offset: true })
});
const PublicationReasonSchema = z.object({
  verified: CounterSchema,
  source_unlocated: CounterSchema,
  source_coverage_gap: CounterSchema,
  source_relation_gap: CounterSchema,
  source_relation_conflict: CounterSchema,
  semantic_unknown: CounterSchema,
  semantic_disagreement: CounterSchema,
  receipt_integrity: CounterSchema
}).strict();
const SubmissionVetoReasonSchema = z.object({
  exact_submission_coverage_gap: CounterSchema,
  exact_submission_relation_gap: CounterSchema,
  exact_submission_relation_conflict: CounterSchema,
  exact_non_submission_overlap: CounterSchema,
  exact_semantic_uncertainty: CounterSchema,
  exact_relevance_disagreement: CounterSchema
}).strict();

const Version3RecordAuthorityAuditCliSchema = z.object({
    version: z.literal(3),
    ...commonFields(LEGACY_RECEIPT_LIMIT_BYTES),
    counters: z.object({
      relevance: z.object({ s: CounterSchema, n: CounterSchema, u: CounterSchema,
        missing: CounterSchema }).strict(),
      source_binding: z.object({ unlocated: CounterSchema, exact_bound: CounterSchema,
        coverage_gap: CounterSchema, relation_gap: CounterSchema,
        relation_conflict: CounterSchema }).strict(),
      semantic_crosscheck: z.object({ consistent: CounterSchema, disagrees: CounterSchema,
        unknown: CounterSchema }).strict(),
      publication: z.object({ verified: CounterSchema, discarded: CounterSchema }).strict(),
      publication_reason: PublicationReasonSchema,
      submission_veto_reason: SubmissionVetoReasonSchema
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

const currentRecordAuthorityAuditCliSchema = (version, receiptLimitBytes) => z.object({
    version: z.literal(version),
    ...commonFields(receiptLimitBytes),
    integrity_complete: z.boolean(),
    package_veto: z.boolean(),
    counters: z.object({
      relevance: z.object({ s: CounterSchema, n: CounterSchema, u: CounterSchema,
        mixed: CounterSchema, missing: CounterSchema }).strict(),
      source_binding: z.object({ unlocated: CounterSchema, exact_bound: CounterSchema,
        coverage_gap: CounterSchema, relation_gap: CounterSchema,
        relation_conflict: CounterSchema }).strict(),
      semantic_crosscheck: z.object({ consistent: CounterSchema, disagrees: CounterSchema,
        unknown: CounterSchema }).strict(),
      publication: z.object({ verified: CounterSchema, discarded: CounterSchema }).strict(),
      publication_reason: PublicationReasonSchema,
      submission_veto_reason: SubmissionVetoReasonSchema
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

const Version4RecordAuthorityAuditCliSchema = currentRecordAuthorityAuditCliSchema(
  4,
  LEGACY_RECEIPT_LIMIT_BYTES
);
const CurrentRecordAuthorityAuditCliSchema = currentRecordAuthorityAuditCliSchema(
  5,
  CURRENT_RECEIPT_LIMIT_BYTES
);

export const RecordAuthorityAuditCliSchema = z.union([
  z.object({
    version: z.union([z.literal(1), z.literal(2)]),
    ...commonFields(LEGACY_RECEIPT_LIMIT_BYTES)
  }).strict(),
  Version3RecordAuthorityAuditCliSchema,
  Version4RecordAuthorityAuditCliSchema,
  CurrentRecordAuthorityAuditCliSchema
]);

const RunIdSchema = z.string().uuid();

export function formatRecordAuthorityAudit(runId, rawAudit) {
  RunIdSchema.parse(runId);
  return RecordAuthorityAuditCliSchema.parse(rawAudit);
}

export async function readRecordAuthorityAudit(runId, databaseUrl, sqlFactory = neon) {
  const id = RunIdSchema.parse(runId);
  if (!databaseUrl) throw new Error("database_not_configured");
  const sql = sqlFactory(databaseUrl);
  const rows = await sql`SELECT record_authority_audit
    FROM runs
    WHERE id = ${id}
    LIMIT 1`;
  if (rows.length !== 1 || rows[0].record_authority_audit === null) {
    throw new Error("record_authority_audit_not_found");
  }
  return formatRecordAuthorityAudit(id, rows[0].record_authority_audit);
}

export async function runCli(argv, dependencies = {}) {
  const stderr = dependencies.stderr ?? ((line) => console.error(line));
  const stdout = dependencies.stdout ?? ((line) => console.log(line));
  const reader = dependencies.reader ?? readRecordAuthorityAudit;
  const databaseUrl = dependencies.databaseUrl ?? process.env.DATABASE_URL;
  if (argv.length !== 1 || !RunIdSchema.safeParse(argv[0]).success) {
    stderr("record_authority_audit_invalid_run_id");
    return 64;
  }
  try {
    const output = await reader(argv[0], databaseUrl);
    stdout(JSON.stringify(output));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "record_authority_audit_not_found") {
      stderr("record_authority_audit_not_found");
      return 2;
    }
    if (message === "database_not_configured") {
      stderr("record_authority_audit_database_not_configured");
      return 78;
    }
    stderr("record_authority_audit_read_failed");
    return 1;
  }
}

export async function main(argv = process.argv.slice(2)) {
  process.exitCode = await runCli(argv);
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedUrl === import.meta.url) await main();
