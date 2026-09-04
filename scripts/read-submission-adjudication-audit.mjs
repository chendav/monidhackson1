import path from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

const Counter = z.number().int().nonnegative().max(10_000);
const reasons = [
  "capacity", "incomplete_page_coverage", "invalid_amendment_metadata", "missing_batch",
  "duplicate_batch", "unknown_batch", "ledger_digest_mismatch", "batch_manifest_mismatch",
  "missing_candidate", "duplicate_candidate", "unknown_candidate", "sha_mismatch",
  "page_mismatch", "channel_mismatch", "offset_mismatch", "quote_too_long",
  "condition_mismatch", "low_confidence", "semantic_uncertainty", "overlap_disagreement",
  "prompt_injection", "draft_disagreement"
];
const reasonShape = Object.fromEntries(reasons.map((reason) => [reason, Counter]));

export const SubmissionAdjudicationAuditCliSchema = z.object({
  version: z.literal(1),
  ledger_digest: z.string().regex(/^[a-f0-9]{64}$/),
  expected_candidate_count: Counter,
  verified_candidate_count: Counter,
  expected_page_count: Counter,
  covered_page_count: Counter,
  expected_source_fragment_count: Counter,
  verified_source_fragment_count: Counter,
  expected_batch_count: Counter,
  verified_batch_count: Counter,
  unresolved_batch_count: Counter,
  complete: z.boolean(),
  resolution_status: z.enum([
    "unique", "none", "possible_only", "multiple", "contradicted", "unresolved"
  ]),
  unresolved_reason_counts: z.object(reasonShape).strict(),
  recorded_at: z.string().datetime({ offset: true })
}).strict().superRefine((audit, context) => {
  const invalid = audit.verified_candidate_count > audit.expected_candidate_count ||
    audit.covered_page_count > audit.expected_page_count ||
    audit.verified_source_fragment_count > audit.expected_source_fragment_count ||
    audit.verified_batch_count > audit.expected_batch_count ||
    audit.unresolved_batch_count !== audit.expected_batch_count - audit.verified_batch_count;
  if (invalid) context.addIssue({ code: "custom", message: "submission_adjudication_audit_count_mismatch" });
  const reasonTotal = Object.values(audit.unresolved_reason_counts)
    .reduce((sum, count) => sum + count, 0);
  const completeFromCounts = reasonTotal === 0 &&
    audit.verified_candidate_count === audit.expected_candidate_count &&
    audit.covered_page_count === audit.expected_page_count &&
    audit.verified_source_fragment_count === audit.expected_source_fragment_count &&
    audit.verified_batch_count === audit.expected_batch_count;
  if (audit.complete !== completeFromCounts) {
    context.addIssue({ code: "custom", message: "submission_adjudication_audit_completeness_mismatch" });
  }
});

const RunIdSchema = z.string().uuid();

export function formatSubmissionAdjudicationAudit(runId, rawAudit) {
  return { run_id: RunIdSchema.parse(runId), ...SubmissionAdjudicationAuditCliSchema.parse(rawAudit) };
}

export async function readSubmissionAdjudicationAudit(runId, databaseUrl, sqlFactory = neon) {
  const id = RunIdSchema.parse(runId);
  if (!databaseUrl) throw new Error("database_not_configured");
  const sql = sqlFactory(databaseUrl);
  const rows = await sql`SELECT submission_adjudication_audit FROM runs WHERE id = ${id} LIMIT 1`;
  if (rows.length !== 1 || rows[0].submission_adjudication_audit === null) {
    throw new Error("submission_adjudication_audit_not_found");
  }
  return formatSubmissionAdjudicationAudit(id, rows[0].submission_adjudication_audit);
}

export async function runCli(argv, dependencies = {}) {
  const stderr = dependencies.stderr ?? ((line) => console.error(line));
  const stdout = dependencies.stdout ?? ((line) => console.log(line));
  const reader = dependencies.reader ?? readSubmissionAdjudicationAudit;
  const databaseUrl = dependencies.databaseUrl ?? process.env.DATABASE_URL;
  if (argv.length !== 1 || !RunIdSchema.safeParse(argv[0]).success) {
    stderr("submission_adjudication_audit_invalid_run_id");
    return 64;
  }
  try {
    stdout(JSON.stringify(await reader(argv[0], databaseUrl)));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "submission_adjudication_audit_not_found") {
      stderr(message);
      return 2;
    }
    if (message === "database_not_configured") {
      stderr("submission_adjudication_audit_database_not_configured");
      return 78;
    }
    stderr("submission_adjudication_audit_read_failed");
    return 1;
  }
}

export async function main(argv = process.argv.slice(2)) {
  process.exitCode = await runCli(argv);
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedUrl === import.meta.url) await main();
