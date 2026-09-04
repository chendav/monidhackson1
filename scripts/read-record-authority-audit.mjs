import path from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

const RECEIPT_LIMIT_BYTES = 262_144;

export const RecordAuthorityAuditCliSchema = z.object({
  version: z.literal(1),
  manifest_digest: z.string().regex(/^[a-f0-9]{64}$/),
  receipt_byte_length: z.number().int().nonnegative().max(RECEIPT_LIMIT_BYTES),
  receipt_limit_bytes: z.literal(RECEIPT_LIMIT_BYTES),
  record_count: z.number().int().nonnegative(),
  complete: z.boolean(),
  recorded_at: z.string().datetime({ offset: true })
}).strict();

const RunIdSchema = z.string().uuid();

export function formatRecordAuthorityAudit(runId, rawAudit) {
  const id = RunIdSchema.parse(runId);
  const audit = RecordAuthorityAuditCliSchema.parse(rawAudit);
  return { run_id: id, ...audit };
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
