import { neon } from "@neondatabase/serverless";

const EXPECTED_SCHEMA_VERSION = 10;
const EXPECTED_MARKER = "rfp-xray-schema-v10";

if (!process.env.DATABASE_URL) {
  console.error("database_schema_probe_failed: DATABASE_URL is not configured");
  process.exit(1);
}

try {
  const sql = neon(process.env.DATABASE_URL);
  const [tables, migrations, markers, dispatchColumns, auditColumns] = await Promise.all([
    sql`SELECT count(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema = 'public'`,
    sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
    sql`SELECT schema_version, marker
        FROM app_schema_meta
        WHERE id = 'current'`,
    sql`SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'runs'
          AND column_name IN (
            'analysis_dispatch_claim_id',
            'analysis_dispatch_claimed_at',
            'analysis_dispatch_status',
            'analysis_dispatch_uncertain_at'
          )`,
    sql`SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'runs'
          AND column_name = 'record_authority_audit'`
  ]);
  const marker = markers[0];
  if (markers.length !== 1 || marker.schema_version !== EXPECTED_SCHEMA_VERSION ||
    marker.marker !== EXPECTED_MARKER) {
    console.error("database_schema_probe_failed: schema marker mismatch");
    process.exit(1);
  }
  if (dispatchColumns.length !== 4) {
    console.error("database_schema_probe_failed: analysis dispatch fence missing");
    process.exit(1);
  }
  if (auditColumns.length !== 1) {
    console.error("database_schema_probe_failed: record authority audit column missing");
    process.exit(1);
  }
  console.log(JSON.stringify({
    status: "ready",
    public_tables: tables[0].count,
    migration_rows: migrations[0].count,
    analysis_dispatch_fence: "ready",
    record_authority_audit: "ready",
    schema_version: marker.schema_version,
    marker: marker.marker
  }));
} catch {
  // Neon errors can embed the connection URL. Never print provider details.
  console.error("database_schema_probe_failed");
  process.exit(1);
}
