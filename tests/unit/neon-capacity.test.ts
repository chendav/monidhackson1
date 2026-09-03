import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import {
  assertNeonCapacityAttested,
  probeNeonCapacity
} from "@/lib/health/neon-capacity";

function productionConfig(overrides: Record<string, string> = {}) {
  return getConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://redacted.invalid/database",
    NEON_COST_CU_CEILING: "1",
    NEON_EXPECTED_MAX_WORKER_PROCESSES: "13",
    ...overrides
  });
}

describe("live Neon cost-capacity attestation", () => {
  it("accepts the exact provider-controlled setting bound to the CU ceiling", async () => {
    const config = productionConfig();
    await expect(probeNeonCapacity(config.DATABASE_URL, config, {
      query: async () => [{ max_worker_processes: "13" }]
    })).resolves.toEqual({
      status: "attested",
      maxWorkerProcesses: 13,
      costCuCeiling: 1
    });
  });

  it("fails closed when the endpoint capacity changes", async () => {
    const config = productionConfig();
    const probe = () => probeNeonCapacity(config.DATABASE_URL, config, {
      query: async () => [{ max_worker_processes: "14" }]
    });
    await expect(probe()).resolves.toEqual({ status: "mismatch" });
    await expect(assertNeonCapacityAttested(config, { probe }))
      .rejects.toThrow(/Neon cost capacity is mismatch/);
  });

  it("rejects a ceiling that cannot cover the published formula boundary", async () => {
    const config = productionConfig({
      NEON_COST_CU_CEILING: "1",
      NEON_EXPECTED_MAX_WORKER_PROCESSES: "14"
    });
    await expect(probeNeonCapacity(config.DATABASE_URL, config, {
      query: async () => [{ max_worker_processes: "14" }]
    })).resolves.toEqual({ status: "configured_unattested" });
  });

  it("collapses provider errors without leaking connection details", async () => {
    const config = productionConfig();
    await expect(probeNeonCapacity(config.DATABASE_URL, config, {
      query: async () => { throw new Error("postgresql://secret.invalid/database"); }
    })).resolves.toEqual({ status: "unreachable" });
  });
});
