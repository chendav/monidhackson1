import { describe, expect, it } from "vitest";
import { HealthResponseSchema } from "@/contracts";

const response = {
  status: "ok" as const,
  version: "1.0" as const,
  mode: "live" as const,
  dependencies: {
    database: "ready" as const,
    neon_capacity: "attested" as const,
    maintenance: "fresh" as const,
    private_storage: "attested" as const,
    workflow: "attested_300s" as const,
    monid: "actively_verified" as const,
    openai: "actively_verified" as const
  },
  storage_provider: "railway_s3" as const,
  storage_safety: "current" as const,
  limits: {
    max_run_cost_micro_usd: 2_000_000,
    daily_cost_cap_micro_usd: 20_000_000
  },
  missing: [] as string[],
  source_scope: "document_only" as const,
  provider_retention: "context_dev_zdr_unavailable_artifact_expiry_observed_7d" as const
};

describe("health response contract", () => {
  it("requires the durable maintenance freshness state", () => {
    expect(HealthResponseSchema.parse(response).dependencies.maintenance).toBe("fresh");
    const withoutMaintenance = structuredClone(response) as Record<string, unknown>;
    delete (withoutMaintenance.dependencies as Record<string, unknown>).maintenance;
    expect(HealthResponseSchema.safeParse(withoutMaintenance).success).toBe(false);
  });

  it.each(["missing", "stale", "unreachable", "not_applicable"] as const)(
    "accepts the fail-closed %s maintenance state",
    (maintenance) => {
      expect(HealthResponseSchema.parse({
        ...response,
        status: maintenance === "not_applicable" ? "degraded" : "not_ready",
        mode: maintenance === "not_applicable" ? "local_fallback" : "unavailable",
        dependencies: { ...response.dependencies, maintenance }
      }).dependencies.maintenance).toBe(maintenance);
    }
  );

  it.each(["configured_unattested", "mismatch", "expired"] as const)(
    "accepts the fail-closed %s Workflow attestation state",
    (workflow) => {
      expect(HealthResponseSchema.parse({
        ...response,
        status: "not_ready",
        mode: "unavailable",
        dependencies: { ...response.dependencies, workflow }
      }).dependencies.workflow).toBe(workflow);
    }
  );

  it.each(["configured_unattested", "mismatch", "unreachable", "not_applicable"] as const)(
    "accepts the fail-closed %s Neon-capacity state",
    (neonCapacity) => {
      expect(HealthResponseSchema.parse({
        ...response,
        status: neonCapacity === "not_applicable" ? "degraded" : "not_ready",
        mode: neonCapacity === "not_applicable" ? "local_fallback" : "unavailable",
        dependencies: { ...response.dependencies, neon_capacity: neonCapacity }
      }).dependencies.neon_capacity).toBe(neonCapacity);
    }
  );

  it.each(["configured_unattested", "mismatch", "expired"] as const)(
    "accepts the fail-closed %s provider-contract state",
    (providerState) => {
      const parsed = HealthResponseSchema.parse({
        ...response,
        status: "not_ready",
        mode: "unavailable",
        dependencies: {
          ...response.dependencies,
          monid: providerState,
          openai: providerState
        }
      });
      expect(parsed.dependencies.monid).toBe(providerState);
      expect(parsed.dependencies.openai).toBe(providerState);
    }
  );
});
