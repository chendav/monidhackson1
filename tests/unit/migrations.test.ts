import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

describe("database migration bundle", () => {
  it("has an ordered journal and one HTTP-safe statement per breakpoint", () => {
    const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });

    expect(migrations).toHaveLength(9);
    expect(migrations.map((migration) => migration.folderMillis)).toEqual([
      1_788_393_600_000,
      1_788_393_601_000,
      1_788_393_602_000,
      1_788_393_603_000,
      1_788_393_604_000,
      1_788_393_605_000,
      1_788_393_606_000,
      1_788_393_607_000,
      1_788_393_608_000
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

    const latest = migrations.at(-1)!.sql.join("\n");
    expect(latest).toContain('ADD COLUMN IF NOT EXISTS "analysis_dispatch_claim_id" uuid');
    expect(latest).toContain('"analysis_dispatch_status" text');
    expect(latest).toContain('"analysis_dispatch_uncertain_at" timestamptz');
    expect(latest).toContain('"analysis_dispatch_claim_id" = "id"');
    expect(latest).toContain('"runs_analysis_dispatch_recovery_idx"');
    expect(latest).toContain('ADD COLUMN IF NOT EXISTS "cleanup_retry_claim_id" uuid');
    expect(latest).toContain('"cleanup_retry_dispatch_uncertain_at" timestamptz');
    expect(latest).toContain('"runs_cleanup_retry_uncertain_idx"');
    expect(latest).toContain('"runs_cleanup_pending_updated_idx"');
    expect(latest).toContain('"runs_cleanup_retry_dispatching_idx"');
    expect(latest).toContain("rfp-xray-schema-v9");
  });
});
