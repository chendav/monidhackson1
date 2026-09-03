import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import { sha256Hex } from "@/lib/crypto";
import { redactForLog } from "@/lib/logging";
import { InMemoryRunStore } from "@/lib/runs/store";
import { authenticateRequest } from "@/lib/security/auth";
import { InMemoryBudgetGuard } from "@/lib/security/budget";

const config = getConfig({
  NODE_ENV: "test",
  SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough",
  IP_HASH_SECRET: "test-ip-hash-secret",
  MAX_RUN_COST_MICRO_USD: "1000",
  DAILY_COST_CAP_MICRO_USD: "2000",
  GUEST_RUNS_PER_DAY: "2",
  API_RUNS_PER_DAY: "10"
});

const requestBody = {
  documents: [{ role: "base" as const, source: { type: "url" as const, url: "https://canadabuys.canada.ca/a.pdf" } }]
};

describe("security, idempotency, quotas, and budget", () => {
  it("authenticates configured API keys by SHA without retaining the token", () => {
    const token = "top-secret-api-token";
    const apiConfig = { ...config, API_KEY_SHA256: sha256Hex(token) };
    const principal = authenticateRequest(new Request("https://app.test/api", {
      headers: { authorization: `Bearer ${token}` }
    }), { config: apiConfig });
    expect(principal.kind).toBe("api");
    expect(principal.id).not.toContain(token);
  });

  it("redacts sensitive fields and large raw strings", () => {
    expect(redactForLog({ authorization: "Bearer secret", source_url: "signed", safe: "ok" }))
      .toEqual({ authorization: "[REDACTED]", source_url: "[REDACTED]", safe: "ok" });
  });

  it("enforces daily run quotas, per-run caps, and daily reservation caps", async () => {
    const guard = new InMemoryBudgetGuard(config);
    await guard.reserve({ runId: crypto.randomUUID(), quotaKey: "ip:a", principalKind: "guest", amountMicroUsd: 800, now: new Date("2026-09-02T01:00:00Z") });
    await guard.reserve({ runId: crypto.randomUUID(), quotaKey: "ip:a", principalKind: "guest", amountMicroUsd: 800, now: new Date("2026-09-02T17:01:00Z") });
    await expect(guard.reserve({ runId: crypto.randomUUID(), quotaKey: "ip:a", principalKind: "guest", amountMicroUsd: 1, now: new Date("2026-09-02T23:02:00Z") }))
      .rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(guard.reserve({ runId: crypto.randomUUID(), quotaKey: "ip:b", principalKind: "guest", amountMicroUsd: 1001, now: new Date("2026-09-02T01:02:00Z") }))
      .rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    await expect(guard.reserve({ runId: crypto.randomUUID(), quotaKey: "ip:b", principalKind: "guest", amountMicroUsd: 500, now: new Date("2026-09-02T01:03:00Z") }))
      .rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("never lowers an existing provider-cost settlement", async () => {
    const monotonicConfig = getConfig({
      NODE_ENV: "test", MAX_RUN_COST_MICRO_USD: "2000", DAILY_COST_CAP_MICRO_USD: "2000",
      GUEST_RUNS_PER_DAY: "10"
    });
    const guard = new InMemoryBudgetGuard(monotonicConfig);
    const runId = crypto.randomUUID();
    await guard.reserve({
      runId, quotaKey: "ip:monotonic", principalKind: "guest", amountMicroUsd: 1_500,
      now: new Date("2026-09-02T01:00:00Z")
    });
    await guard.settle(runId, 1_500);
    await guard.settle(runId, 0);
    await expect(guard.reserve({
      runId: crypto.randomUUID(), quotaKey: "ip:other", principalKind: "guest", amountMicroUsd: 501,
      now: new Date("2026-09-02T12:00:00Z")
    })).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });

  it("trips the budget circuit when observed cost exceeds its reservation or run cap", async () => {
    const guard = new InMemoryBudgetGuard(config);
    const runId = crypto.randomUUID();
    await guard.reserve({
      runId,
      quotaKey: "ip:overage",
      principalKind: "guest",
      amountMicroUsd: 800,
      now: new Date("2026-09-02T01:00:00Z")
    });
    await expect(guard.settle(runId, 801)).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
      retryable: false
    });
    await expect(guard.settle(runId, 1_001)).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
      retryable: false
    });
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      await expect(guard.settle(runId, invalid)).rejects.toMatchObject({
        code: "BUDGET_EXCEEDED",
        retryable: false
      });
    }
  });

  it("deduplicates identical requests and rejects idempotency-key reuse with different input", async () => {
    const store = new InMemoryRunStore();
    const first = await store.create({ ownerId: "guest:a", quotaKey: "ip:a", input: requestBody, idempotencyKey: "request-123", reservedMicroUsd: 100 });
    const replay = await store.create({ ownerId: "guest:a", quotaKey: "ip:a", input: requestBody, idempotencyKey: "request-123", reservedMicroUsd: 100 });
    expect(replay.created).toBe(false);
    expect(replay.record.id).toBe(first.record.id);
    await expect(store.create({
      ownerId: "guest:a", quotaKey: "ip:a",
      input: { documents: [{ role: "base", source: { type: "url", url: "https://canadabuys.canada.ca/b.pdf" } }] },
      idempotencyKey: "request-123", reservedMicroUsd: 100
    })).rejects.toMatchObject({ httpStatus: 409 });
  });
});
