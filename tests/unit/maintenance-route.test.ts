import { describe, expect, it, vi } from "vitest";
import { getConfig } from "@/lib/config";
import { handleMaintenance, isAuthorizedMaintenanceRequest } from "@/app/api/internal/maintenance/route";
import { InMemoryRunStore } from "@/lib/runs/store";
import { InMemoryBudgetGuard } from "@/lib/security/budget";
import type { UploadStorage } from "@/lib/storage/uploads";

function request(authorization?: string) {
  return new Request("https://rfp.example/api/internal/maintenance", {
    headers: authorization ? { authorization } : undefined
  });
}

describe("maintenance cron route", () => {
  const secret = "cron-secret-at-least-sixteen-characters";
  const config = getConfig({ NODE_ENV: "test", CRON_SECRET: secret });

  it("requires the exact Bearer credential", () => {
    expect(isAuthorizedMaintenanceRequest(request(`Bearer ${secret}`), secret)).toBe(true);
    expect(isAuthorizedMaintenanceRequest(request(`bearer ${secret}`), secret)).toBe(false);
    expect(isAuthorizedMaintenanceRequest(request(`Bearer  ${secret}`), secret)).toBe(false);
    expect(isAuthorizedMaintenanceRequest(request(`${secret}`), secret)).toBe(false);
    expect(isAuthorizedMaintenanceRequest(request(), secret)).toBe(false);
  });

  it("rejects unauthorized calls without running reconciliation", async () => {
    const sweepExpiredIncoming = vi.fn(async () => []);
    const response = await handleMaintenance(request("Bearer wrong"), {
      config,
      store: new InMemoryRunStore(),
      storage: { sweepExpiredIncoming } as unknown as UploadStorage
    });
    expect(response.status).toBe(401);
    expect(sweepExpiredIncoming).not.toHaveBeenCalled();
  });

  it("runs expiry and upload reconciliation for an authorized call", async () => {
    const sweepExpiredIncoming = vi.fn(async () => []);
    const response = await handleMaintenance(request(`Bearer ${secret}`), {
      config,
      store: new InMemoryRunStore(),
      storage: { sweepExpiredIncoming } as unknown as UploadStorage,
      now: new Date("2026-09-02T00:00:00Z")
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      recovered_run_count: 0,
      admission_failure_count: 0,
      expired_run_count: 0
    });
    expect(sweepExpiredIncoming).toHaveBeenCalledOnce();
    expect(sweepExpiredIncoming).toHaveBeenCalledWith(new Date("2026-09-02T00:00:00Z"), 100);
  });

  it("recovers an unscheduled queued run after the admission grace period", async () => {
    const store = new InMemoryRunStore();
    const now = new Date("2026-09-02T00:05:00Z");
    const stranded = await store.create({
      ownerId: "guest:stranded",
      quotaKey: "ip:stranded",
      input: { documents: [{
        role: "base",
        source: { type: "url", url: "https://canadabuys.canada.ca/stranded.pdf" }
      }] },
      idempotencyKey: "stranded",
      reservedMicroUsd: 250_000,
      now: new Date("2026-09-02T00:00:00Z")
    });
    const sweepExpiredIncoming = vi.fn(async () => []);
    const schedule = vi.fn(async () => "workflow-from-maintenance");
    const response = await handleMaintenance(request(`Bearer ${secret}`), {
      config,
      store,
      budget: new InMemoryBudgetGuard(config),
      storage: { sweepExpiredIncoming } as unknown as UploadStorage,
      schedule,
      now
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      recovered_run_count: 1,
      admission_failure_count: 0
    });
    expect(schedule).toHaveBeenCalledExactlyOnceWith(stranded.record.id);
    expect((await store.get(stranded.record.id))?.workflowRunId).toBe("workflow-from-maintenance");
  });

  it("is unavailable when CRON_SECRET is not configured", async () => {
    const response = await handleMaintenance(request("Bearer anything"), {
      config: getConfig({ NODE_ENV: "test", CRON_SECRET: undefined })
    });
    expect(response.status).toBe(503);
  });
});
