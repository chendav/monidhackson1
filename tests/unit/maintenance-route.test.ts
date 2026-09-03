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
    const recordHeartbeat = vi.fn(async () => undefined);
    const response = await handleMaintenance(request(`Bearer ${secret}`), {
      config,
      store: new InMemoryRunStore(),
      storage: { sweepExpiredIncoming } as unknown as UploadStorage,
      recordHeartbeat,
      now: new Date("2026-09-02T00:00:00Z")
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      bounded: true,
      maintenance_heartbeat_recorded: true,
      recovered_run_count: 0,
      admission_failure_count: 0,
      admission_deferred_count: 0,
      expired_run_count: 0
    });
    expect(sweepExpiredIncoming).toHaveBeenCalledOnce();
    expect(sweepExpiredIncoming).toHaveBeenCalledWith(new Date("2026-09-02T00:00:00Z"), 10);
    expect(recordHeartbeat).toHaveBeenCalledOnce();
    expect(recordHeartbeat).toHaveBeenCalledWith(expect.objectContaining({
      completedAt: expect.any(Date),
      workBudgetMs: 45_000,
      recoveredRunCount: 0,
      expiredRunCount: 0
    }));
    expect(sweepExpiredIncoming.mock.invocationCallOrder[0])
      .toBeLessThan(recordHeartbeat.mock.invocationCallOrder[0]);
  });

  it("uses small server-side batches for every recurring maintenance queue", async () => {
    const store = new InMemoryRunStore();
    const listUnscheduled = vi.spyOn(store, "listUnscheduledQueued");
    const listCleanup = vi.spyOn(store, "listCleanupCandidates");
    const sweepExpiredIncoming = vi.fn(async () => []);
    const response = await handleMaintenance(request(`Bearer ${secret}`), {
      config,
      store,
      storage: { sweepExpiredIncoming } as unknown as UploadStorage,
      recordHeartbeat: vi.fn(async () => undefined),
      now: new Date("2026-09-02T00:00:00Z")
    });

    expect(response.status).toBe(200);
    expect(listUnscheduled).toHaveBeenCalledWith(new Date("2026-09-01T23:59:00Z"), 5);
    expect(listCleanup).toHaveBeenCalledWith(new Date("2026-09-02T00:00:00Z"), 5);
    expect(sweepExpiredIncoming).toHaveBeenCalledWith(new Date("2026-09-02T00:00:00Z"), 10);
  });

  it("fails closed at the internal deadline and does not refresh the heartbeat", async () => {
    const recordHeartbeat = vi.fn(async () => undefined);
    const response = await handleMaintenance(request(`Bearer ${secret}`), {
      config,
      store: new InMemoryRunStore(),
      storage: {
        sweepExpiredIncoming: vi.fn(() => new Promise(() => undefined))
      } as unknown as UploadStorage,
      recordHeartbeat,
      timeBudgetMs: 5,
      now: new Date("2026-09-02T00:00:00Z")
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "maintenance_deadline_exceeded" });
    expect(recordHeartbeat).not.toHaveBeenCalled();
  });

  it("does not refresh the heartbeat when bounded maintenance work fails", async () => {
    const recordHeartbeat = vi.fn(async () => undefined);
    const response = await handleMaintenance(request(`Bearer ${secret}`), {
      config,
      store: new InMemoryRunStore(),
      storage: {
        sweepExpiredIncoming: vi.fn(async () => { throw new Error("provider detail"); })
      } as unknown as UploadStorage,
      recordHeartbeat,
      now: new Date("2026-09-02T00:00:00Z")
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "maintenance_failed" });
    expect(recordHeartbeat).not.toHaveBeenCalled();
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

  it("terminally cleans a stale queued run instead of dispatching a second analysis Workflow", async () => {
    const store = new InMemoryRunStore();
    const createdAt = new Date("2026-09-02T00:00:00Z");
    const now = new Date("2026-09-02T00:05:00Z");
    const stranded = await store.create({
      ownerId: "guest:dead-workflow", quotaKey: "ip:dead-workflow",
      input: { documents: [{
        role: "base", source: { type: "url", url: "https://canadabuys.canada.ca/dead-workflow.pdf" }
      }] },
      idempotencyKey: "dead-workflow", reservedMicroUsd: 250_000, now: createdAt
    });
    await store.update(stranded.record.id, (record) => ({
      ...record, workflowRunId: "workflow-that-died-before-claim", updatedAt: createdAt.toISOString()
    }));
    const schedule = vi.fn(async () => "replacement-workflow");
    const response = await handleMaintenance(request(`Bearer ${secret}`), {
      config,
      store,
      budget: new InMemoryBudgetGuard(config),
      storage: {
        remove: vi.fn(async () => undefined),
        sweepExpiredIncoming: vi.fn(async () => [])
      } as unknown as UploadStorage,
      schedule,
      now
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ recovered_run_count: 0, admission_failure_count: 1 });
    expect(schedule).not.toHaveBeenCalled();
    expect(await store.get(stranded.record.id)).toMatchObject({
      status: "failed",
      workflowRunId: "workflow-that-died-before-claim",
      cleanupConfirmed: true,
      error: { code: "ANALYSIS_INCOMPLETE", retryable: false }
    });
  });

  it("does not blind-redispatch a delayed legacy Workflow", async () => {
    const store = new InMemoryRunStore();
    const createdAt = new Date("2026-09-02T00:00:00Z");
    const now = new Date("2026-09-02T00:05:00Z");
    const stranded = await store.create({
      ownerId: "guest:delayed-workflow", quotaKey: "ip:delayed-workflow",
      input: { documents: [{
        role: "base", source: { type: "url", url: "https://canadabuys.canada.ca/delayed-workflow.pdf" }
      }] },
      idempotencyKey: "delayed-workflow", reservedMicroUsd: 250_000, now: createdAt
    });
    await store.update(stranded.record.id, (record) => ({
      ...record, workflowRunId: "workflow-still-delayed", updatedAt: createdAt.toISOString()
    }));
    const schedule = vi.fn(async () => { throw new Error("enqueue acknowledgement lost"); });
    const response = await handleMaintenance(request(`Bearer ${secret}`), {
      config,
      store,
      budget: new InMemoryBudgetGuard(config),
      storage: {
        remove: vi.fn(async () => undefined),
        sweepExpiredIncoming: vi.fn(async () => [])
      } as unknown as UploadStorage,
      schedule,
      now
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      recovered_run_count: 0,
      admission_failure_count: 1,
      admission_deferred_count: 0
    });
    expect(schedule).not.toHaveBeenCalled();
    expect(await store.get(stranded.record.id)).toMatchObject({
      status: "failed",
      workflowRunId: "workflow-still-delayed",
      cleanupConfirmed: true
    });
  });

  it("is unavailable when CRON_SECRET is not configured", async () => {
    const response = await handleMaintenance(request("Bearer anything"), {
      config: getConfig({ NODE_ENV: "test", CRON_SECRET: undefined })
    });
    expect(response.status).toBe(503);
  });
});
