import { describe, expect, it } from "vitest";
import { APP_SCHEMA_MARKER, APP_SCHEMA_VERSION } from "@/db/schema";
import { probeDatabaseSchema } from "@/lib/health/database";

describe("database schema health", () => {
  it("distinguishes missing, unreachable, mismatched, and exact schema states", async () => {
    await expect(probeDatabaseSchema(undefined)).resolves.toEqual({ status: "missing" });
    await expect(probeDatabaseSchema("postgresql://redacted.invalid/db", {
      query: async () => { throw new Error("secret provider detail"); }
    })).resolves.toEqual({ status: "unreachable" });
    await expect(probeDatabaseSchema("postgresql://redacted.invalid/db", {
      query: async () => [{ schema_version: APP_SCHEMA_VERSION - 1, marker: APP_SCHEMA_MARKER }]
    })).resolves.toEqual({ status: "schema_mismatch" });
    await expect(probeDatabaseSchema("postgresql://redacted.invalid/db", {
      query: async () => [{ schema_version: APP_SCHEMA_VERSION, marker: APP_SCHEMA_MARKER }]
    })).resolves.toEqual({
      status: "ready",
      schemaVersion: APP_SCHEMA_VERSION,
      marker: APP_SCHEMA_MARKER
    });
  });

  it("fails closed on a stalled query without surfacing provider details", async () => {
    await expect(probeDatabaseSchema("postgresql://should-not-appear.invalid/db", {
      timeoutMs: 5,
      query: () => new Promise(() => undefined)
    })).resolves.toEqual({ status: "unreachable" });
  });
});
