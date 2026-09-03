import { describe, expect, it } from "vitest";
import { AnalysisResultSchema, CreateRunResponseSchema, RunStatusResponseSchema } from "@/contracts";
import { GET as getEdmontonSample } from "@/app/api/v1/samples/edmonton/route";
import { buildOpenApiDocument } from "@/lib/api/openapi";
import { getConfig } from "@/lib/config";
import { createRun } from "@/lib/runs/create";
import { InMemoryRunStore } from "@/lib/runs/store";
import { toRunStatusResponse } from "@/lib/runs/types";
import { InMemoryBudgetGuard } from "@/lib/security/budget";

const config = getConfig({
  NODE_ENV: "test",
  SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough",
  IP_HASH_SECRET: "test-ip-hash-secret",
  MAX_RUN_COST_MICRO_USD: "2000000",
  DAILY_COST_CAP_MICRO_USD: "20000000"
});

describe("versioned public API contract", () => {
  it("publishes every locked route and security boundary in OpenAPI", () => {
    const document = buildOpenApiDocument("https://rfp.example");
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths)).toEqual(expect.arrayContaining([
      "/api/v1/uploads/presign",
      "/api/v1/runs",
      "/api/v1/runs/{run_id}",
      "/api/v1/runs/{run_id}/analysis",
      "/api/v1/runs/{run_id}/questions",
      "/api/v1/samples/edmonton",
      "/api/health",
      "/api/openapi.json"
    ]));
    expect(document.paths["/api/v1/runs/{run_id}"].delete).toBeDefined();
    expect(document.components.securitySchemes).toHaveProperty("BearerAuth");
    expect(document.components.securitySchemes).toHaveProperty("SessionCookie");
  });

  it("returns the frozen analysis schema from the Edmonton sample route", async () => {
    const response = await getEdmontonSample();
    expect(response.status).toBe(200);
    expect(AnalysisResultSchema.parse(await response.json()).schema_version).toBe("1.0");
  });

  it("creates and idempotently replays a run with frozen response/status shapes", async () => {
    const store = new InMemoryRunStore();
    const budget = new InMemoryBudgetGuard(config);
    const principal = { id: "guest:contract", quotaKey: "ip:contract", kind: "guest" as const };
    const input = {
      documents: [{ role: "base", source: { type: "url", url: "https://canadabuys.canada.ca/tender.pdf" } }]
    };
    const first = await createRun(input, principal, "contract-request-1", {
      config, store, budget, schedule: async () => null
    });
    const replay = await createRun(input, principal, "contract-request-1", {
      config, store, budget, schedule: async () => null
    });
    expect(CreateRunResponseSchema.parse(first.response).run_id).toBe(first.record.id);
    expect(replay.created).toBe(false);
    expect(replay.record.id).toBe(first.record.id);
    expect(RunStatusResponseSchema.parse(toRunStatusResponse(first.record)).cleanup_confirmed).toBe(false);
    await expect(createRun(input, principal, "contract-request-2", {
      config, store, budget, schedule: async () => null
    })).rejects.toMatchObject({ code: "RATE_LIMITED", httpStatus: 429 });
  });
});
