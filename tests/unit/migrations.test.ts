import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

describe("database migration bundle", () => {
  it("has an ordered journal and one HTTP-safe statement per breakpoint", () => {
    const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });

    expect(migrations).toHaveLength(8);
    expect(migrations.map((migration) => migration.folderMillis)).toEqual([
      1_788_393_600_000,
      1_788_393_601_000,
      1_788_393_602_000,
      1_788_393_603_000,
      1_788_393_604_000,
      1_788_393_605_000,
      1_788_393_606_000,
      1_788_393_607_000
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
    expect(latest).toContain('CREATE TABLE IF NOT EXISTS "release_attestations"');
    expect(latest).toContain("rfp-xray-schema-v8");
    expect(latest).toContain('"payload_sha256" text');
  });
});
