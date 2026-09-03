import { describe, expect, it, vi } from "vitest";
import {
  MAINTENANCE_HEARTBEAT_MAX_AGE_MS,
  probeMaintenanceHeartbeat,
  recordMaintenanceHeartbeat
} from "@/lib/health/maintenance";

describe("durable maintenance heartbeat", () => {
  const now = new Date("2026-09-03T12:15:00.000Z");

  it("distinguishes missing, stale, and fresh successful heartbeats", async () => {
    await expect(probeMaintenanceHeartbeat(undefined, now)).resolves.toEqual({ status: "missing" });
    await expect(probeMaintenanceHeartbeat("postgresql://redacted.invalid/db", now, {
      query: async () => []
    })).resolves.toEqual({ status: "missing" });
    await expect(probeMaintenanceHeartbeat("postgresql://redacted.invalid/db", now, {
      query: async () => [{
        completed_at: new Date(now.getTime() - MAINTENANCE_HEARTBEAT_MAX_AGE_MS - 1),
        duration_ms: 1_200,
        work_budget_ms: 45_000
      }]
    })).resolves.toEqual({ status: "stale" });
    await expect(probeMaintenanceHeartbeat("postgresql://redacted.invalid/db", now, {
      query: async () => [{
        completed_at: new Date(now.getTime() - 5 * 60_000),
        duration_ms: 1_200,
        work_budget_ms: 45_000
      }]
    })).resolves.toEqual({
      status: "fresh",
      completedAt: "2026-09-03T12:10:00.000Z",
      ageMs: 5 * 60_000
    });
  });

  it("rejects future or unbounded rows as freshness proof", async () => {
    await expect(probeMaintenanceHeartbeat("postgresql://redacted.invalid/db", now, {
      query: async () => [{
        completed_at: new Date(now.getTime() + 60_001),
        duration_ms: 100,
        work_budget_ms: 45_000
      }]
    })).resolves.toEqual({ status: "stale" });
    await expect(probeMaintenanceHeartbeat("postgresql://redacted.invalid/db", now, {
      query: async () => [{
        completed_at: now,
        duration_ms: 50_001,
        work_budget_ms: 45_000
      }]
    })).resolves.toEqual({ status: "stale" });
    await expect(probeMaintenanceHeartbeat("postgresql://redacted.invalid/db", now, {
      query: async () => [{
        completed_at: now,
        duration_ms: 40_001,
        work_budget_ms: 40_000
      }]
    })).resolves.toEqual({ status: "stale" });
  });

  it("collapses provider failures and timeouts to unreachable", async () => {
    await expect(probeMaintenanceHeartbeat("postgresql://must-not-appear.invalid/db", now, {
      query: async () => { throw new Error("provider secret"); }
    })).resolves.toEqual({ status: "unreachable" });
    await expect(probeMaintenanceHeartbeat("postgresql://must-not-appear.invalid/db", now, {
      timeoutMs: 5,
      query: () => new Promise(() => undefined)
    })).resolves.toEqual({ status: "unreachable" });
  });

  it("persists only bounded count-and-timing summaries", async () => {
    const execute = vi.fn(async () => undefined);
    const summary = {
      completedAt: now,
      durationMs: 2_500,
      workBudgetMs: 45_000,
      recoveredRunCount: 2,
      admissionFailureCount: 0,
      admissionDeferredCount: 1,
      expiredRunCount: 3
    };
    await recordMaintenanceHeartbeat("postgresql://not-used.invalid/db", summary, { execute });
    expect(execute).toHaveBeenCalledExactlyOnceWith(summary);
    await expect(recordMaintenanceHeartbeat("postgresql://not-used.invalid/db", {
      ...summary,
      durationMs: 50_001
    }, { execute })).rejects.toThrow("not bounded");
    await expect(recordMaintenanceHeartbeat("postgresql://not-used.invalid/db", {
      ...summary,
      durationMs: 40_001,
      workBudgetMs: 40_000
    }, { execute })).rejects.toThrow("not bounded");
  });
});
