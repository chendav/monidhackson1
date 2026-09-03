import { neon } from "@neondatabase/serverless";
import { APP_SCHEMA_MARKER, APP_SCHEMA_VERSION } from "@/db/schema";

export type DatabaseSchemaHealth =
  | { status: "ready"; schemaVersion: number; marker: string }
  | { status: "missing" | "unreachable" | "schema_mismatch" };

interface SchemaRow {
  schema_version: number;
  marker: string;
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("database health probe timed out")), timeoutMs);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Proves that the configured database is reachable and has the exact schema
 * required by this build. Provider errors are deliberately collapsed to a
 * status so a connection string can never escape through the public health
 * response or application logs.
 */
export async function probeDatabaseSchema(
  databaseUrl: string | undefined,
  options: {
    timeoutMs?: number;
    query?: () => Promise<SchemaRow[]>;
  } = {}
): Promise<DatabaseSchemaHealth> {
  if (!databaseUrl) return { status: "missing" };
  try {
    const query = options.query ?? (async () => {
      const sql = neon(databaseUrl);
      return await sql`
        SELECT schema_version, marker
        FROM app_schema_meta
        WHERE id = 'current'
        LIMIT 1
      ` as SchemaRow[];
    });
    const rows = await within(query(), options.timeoutMs ?? 2_500);
    const row = rows[0];
    if (rows.length !== 1 || row.schema_version !== APP_SCHEMA_VERSION ||
      row.marker !== APP_SCHEMA_MARKER) {
      return { status: "schema_mismatch" };
    }
    return { status: "ready", schemaVersion: row.schema_version, marker: row.marker };
  } catch {
    return { status: "unreachable" };
  }
}
