import { describe, expect, it } from "vitest";
import {
  buildInfrastructureCostEstimateEvents,
  hasCompleteInfrastructureCostCoverage,
  infrastructureCostCommitmentMicroUsd
} from "@/lib/cost-estimates";

describe("versioned infrastructure cost estimates", () => {
  it("accounts for every active production infrastructure provider", () => {
    const events = buildInfrastructureCostEstimateEvents({
      documentCount: 5,
      storageProvider: "railway_s3",
      neonCostCuCeiling: 1,
      runTtlHours: 24,
      observedPipelineLatencyMs: 12_345.4
    });

    expect(events.map((event) => event.provider)).toEqual([
      "vercel", "vercel", "vercel", "vercel", "vercel", "neon", "railway_s3"
    ]);
    expect(events.map((event) => event.operation)).toEqual([
      "fluid_compute_conservative_usage_allocation",
      "workflow_events_conservative_usage_allocation",
      "workflow_data_written_conservative_usage_allocation",
      "workflow_data_retained_conservative_usage_allocation",
      "workflow_queue_conservative_usage_allocation",
      "serverless_postgres_conservative_usage_allocation",
      "temporary_bucket_conservative_usage_allocation"
    ]);
    expect(events.map((event) => event.estimated_micro_usd)).toEqual([
      736_251, 25_000, 40_960, 10_923, 12_000, 69_487, 2
    ]);
    expect(hasCompleteInfrastructureCostCoverage(events, "vercel")).toBe(true);
    expect(hasCompleteInfrastructureCostCoverage(events, "neon")).toBe(true);
    expect(hasCompleteInfrastructureCostCoverage(events, "railway_s3")).toBe(true);
    expect(hasCompleteInfrastructureCostCoverage(
      events.filter((event) => event.operation !== "workflow_data_retained_conservative_usage_allocation"),
      "vercel"
    )).toBe(false);
    expect(events.every((event) =>
      event.actual_micro_usd === null &&
      (event.estimated_micro_usd ?? 0) > 0 &&
      event.status === "succeeded" &&
      event.latency_ms === 12_345 &&
      (event.estimation_basis?.length ?? 0) > 40 &&
      event.pricing_source_url?.startsWith("https://") &&
      event.pricing_observed_at === "2026-09-03T00:00:00.000Z"
    )).toBe(true);
    expect(infrastructureCostCommitmentMicroUsd({
      documentCount: 5,
      storageProvider: "railway_s3",
      neonCostCuCeiling: 1,
      runTtlHours: 24
    })).toBe(894_623);
    expect(894_623 + 495_000 + (5 * 4_500)).toBe(1_412_123);
    expect(1_412_123).toBeLessThan(2_000_000);
  });

  it("does not claim a Railway estimate when that adapter is not selected", () => {
    expect(buildInfrastructureCostEstimateEvents({
      documentCount: 1,
      storageProvider: null,
      neonCostCuCeiling: 1,
      runTtlHours: 24
    }).map((event) => event.provider)).toEqual([
      "vercel", "vercel", "vercel", "vercel", "vercel", "neon"
    ]);
  });

  it("pins the one-document formula and every billed Vercel dimension", () => {
    const events = buildInfrastructureCostEstimateEvents({
      documentCount: 1,
      storageProvider: null,
      neonCostCuCeiling: 1,
      runTtlHours: 24
    });
    expect(events.map((event) => event.estimated_micro_usd)).toEqual([
      736_251, 25_000, 40_960, 10_923, 12_000, 50_987
    ]);
    expect(infrastructureCostCommitmentMicroUsd({
      documentCount: 1,
      storageProvider: null,
      neonCostCuCeiling: 1,
      runTtlHours: 24
    })).toBe(876_121);
  });

  it("derives Workflow retention from the configured run TTL", () => {
    const event = buildInfrastructureCostEstimateEvents({
      documentCount: 1,
      storageProvider: null,
      neonCostCuCeiling: 1,
      runTtlHours: 168
    }).find((candidate) =>
      candidate.operation === "workflow_data_retained_conservative_usage_allocation"
    );
    expect(event).toMatchObject({ estimated_micro_usd: 19_115 });
    expect(event?.estimation_basis).toContain("168-hour run lifetime");
  });

  it("rejects document counts outside the public contract", () => {
    expect(() => buildInfrastructureCostEstimateEvents({
      documentCount: 0,
      storageProvider: null,
      neonCostCuCeiling: 1,
      runTtlHours: 24
    }))
      .toThrow(/one to five documents/);
    expect(() => buildInfrastructureCostEstimateEvents({
      documentCount: 6,
      storageProvider: null,
      neonCostCuCeiling: 1,
      runTtlHours: 24
    }))
      .toThrow(/one to five documents/);
    expect(() => buildInfrastructureCostEstimateEvents({
      documentCount: 1,
      storageProvider: null,
      neonCostCuCeiling: 0,
      runTtlHours: 24
    })).toThrow(/valid Neon CU ceiling/);
    expect(() => buildInfrastructureCostEstimateEvents({
      documentCount: 1,
      storageProvider: null,
      neonCostCuCeiling: 1,
      runTtlHours: 169
    })).toThrow(/one-to-168-hour run TTL/);
  });
});
