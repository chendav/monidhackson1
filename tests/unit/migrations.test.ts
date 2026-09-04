import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

describe("database migration bundle", () => {
  it("has an ordered journal and one HTTP-safe statement per breakpoint", () => {
    const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });

    expect(migrations).toHaveLength(11);
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
      1_788_393_609_000,
      1_788_393_610_000
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

    const dispatchMigration = migrations.at(-3)!.sql.join("\n");
    expect(dispatchMigration).toContain('ADD COLUMN IF NOT EXISTS "analysis_dispatch_claim_id" uuid');
    expect(dispatchMigration).toContain('"analysis_dispatch_status" text');
    expect(dispatchMigration).toContain('"analysis_dispatch_uncertain_at" timestamptz');
    expect(dispatchMigration).toContain('"analysis_dispatch_claim_id" = "id"');
    expect(dispatchMigration).toContain('"runs_analysis_dispatch_recovery_idx"');
    expect(dispatchMigration).toContain('ADD COLUMN IF NOT EXISTS "cleanup_retry_claim_id" uuid');
    expect(dispatchMigration).toContain('"cleanup_retry_dispatch_uncertain_at" timestamptz');
    expect(dispatchMigration).toContain('"runs_cleanup_retry_uncertain_idx"');
    expect(dispatchMigration).toContain('"runs_cleanup_pending_updated_idx"');
    expect(dispatchMigration).toContain('"runs_cleanup_retry_dispatching_idx"');
    expect(dispatchMigration).toContain("rfp-xray-schema-v9");

    const recordAudit = migrations.at(-2)!.sql.join("\n");
    expect(recordAudit).toContain('ADD COLUMN IF NOT EXISTS "record_authority_audit" jsonb');
    expect(recordAudit).toContain("rfp-xray-schema-v10");

    const latest = migrations.at(-1)!.sql.join("\n");
    expect(latest).toContain('ADD COLUMN IF NOT EXISTS "submission_adjudication_audit" jsonb');
    expect(latest).toContain("rfp-xray-schema-v11");
  });
});
