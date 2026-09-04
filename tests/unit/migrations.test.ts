import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

describe("database migration bundle", () => {
  it("has an ordered journal and one HTTP-safe statement per breakpoint", () => {
    const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });

    expect(migrations).toHaveLength(10);
    expect(migrations.map((migration) => migration.folderMillis)).toEqual([
      1_788_393_600_000,
      1_788_393_601_000,
      1_788_393_602_000,
      1_788_393_603_000,
      1_788_393_604_000,
      1_788_393_605_000,
      1_788_393_606_000,
      1_788_393_607_000,
      1_788_393_608_000,
      1_788_393_609_000
    ]);

    for (const migration of migrations) {
      expect(migration.sql.length).toBeGreaterThan(0);
      for (const statement of migration.sql) {
        const normalized = statement.trim();
        expect(normalized).not.toBe("");
        expect(normalized.endsWith(";")).toBe(true);
        expect(normalized.slice(0, -1)).not.toContain(";");
      }
    }

    const previous = migrations.at(-2)!.sql.join("\n");
    expect(previous).toContain('ADD COLUMN IF NOT EXISTS "analysis_dispatch_claim_id" uuid');
    expect(previous).toContain('"analysis_dispatch_status" text');
    expect(previous).toContain('"analysis_dispatch_uncertain_at" timestamptz');
    expect(previous).toContain('"analysis_dispatch_claim_id" = "id"');
    expect(previous).toContain('"runs_analysis_dispatch_recovery_idx"');
    expect(previous).toContain('ADD COLUMN IF NOT EXISTS "cleanup_retry_claim_id" uuid');
    expect(previous).toContain('"cleanup_retry_dispatch_uncertain_at" timestamptz');
    expect(previous).toContain('"runs_cleanup_retry_uncertain_idx"');
    expect(previous).toContain('"runs_cleanup_pending_updated_idx"');
    expect(previous).toContain('"runs_cleanup_retry_dispatching_idx"');
    expect(previous).toContain("rfp-xray-schema-v9");

    const latest = migrations.at(-1)!.sql.join("\n");
    expect(latest).toContain('ADD COLUMN IF NOT EXISTS "record_authority_audit" jsonb');
    expect(latest).toContain("rfp-xray-schema-v10");
  });
});
