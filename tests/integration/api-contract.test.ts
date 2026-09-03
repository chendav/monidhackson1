import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AnalysisResultSchema,
  ApiErrorSchema,
  CreateRunRequestSchema,
  CreateRunResponseSchema,
  PresignUploadRequestSchema,
  QuestionRequestSchema,
  QuestionResponseSchema,
  RunStatusResponseSchema,
  errorCodes,
  runStatuses
} from "@/contracts";
import { GET as getEdmontonSample } from "@/app/api/v1/samples/edmonton/route";
import { buildOpenApiDocument } from "@/lib/api/openapi";
import { getConfig } from "@/lib/config";
import { createRun } from "@/lib/runs/create";
import { InMemoryRunStore } from "@/lib/runs/store";
import { toRunStatusResponse } from "@/lib/runs/types";
import { InMemoryBudgetGuard } from "@/lib/security/budget";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as JsonObject;
}

function zodJsonSchema(schema: z.ZodType): JsonObject {
  const generated = { ...z.toJSONSchema(schema, { target: "draft-2020-12" }) } as JsonObject;
  delete generated.$schema;
  return generated;
}

const citation = {
  document_sha256: "a".repeat(64),
  document_name: "source.pdf",
  source_url: null,
  pdf_page_1based: 7,
  printed_page_label: "3 of 47",
  section: "Mandatory requirements",
  evidence_quote: "The bidder must provide the requested evidence.",
  verified: true,
  verification_method: "exact" as const
};

const config = getConfig({
  NODE_ENV: "test",
  SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough",
  IP_HASH_SECRET: "test-ip-hash-secret",
  MAX_RUN_COST_MICRO_USD: "2000000",
  DAILY_COST_CAP_MICRO_USD: "20000000"
});

describe("versioned public API contract", () => {
  it("publishes every locked route, compatibility alias, and security boundary", () => {
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
      "/api/openapi.json",
      "/api/v1/runs/{run_id}/result",
      "/api/v1/sample",
      "/api/v1/health",
      "/api/v1/openapi.json"
    ]));
    expect(document.paths["/api/v1/runs/{run_id}"].delete).toBeDefined();
    expect(document.components.securitySchemes).toHaveProperty("BearerAuth");
    expect(document.components.securitySchemes).toHaveProperty("SessionCookie");
    expect(document.paths["/api/v1/runs/{run_id}/result"].get.deprecated).toBe(true);
    expect(document.paths["/api/v1/sample"].get.deprecated).toBe(true);
  });

  it("documents a distinct action-bound Turnstile token on every guest mutation", () => {
    const document = buildOpenApiDocument("https://rfp.example");
    const mutations = [
      [document.paths["/api/v1/uploads/presign"].post, "upload_presign"],
      [document.paths["/api/v1/runs"].post, "create_run"],
      [document.paths["/api/v1/runs/{run_id}/questions"].post, "ask_question"],
      [document.paths["/api/v1/runs/{run_id}"].delete, "delete_run"]
    ] as const;

    for (const [operation, action] of mutations) {
      const parameter = operation.parameters.find(
        (candidate) => "name" in candidate && candidate.name === "X-Turnstile-Token"
      );
      expect(parameter).toMatchObject({
        in: "header",
        required: false,
        "x-turnstile-action": action
      });
      expect(parameter && "description" in parameter ? parameter.description : "")
        .toContain(`\`${action}\``);
      expect(parameter && "description" in parameter ? parameter.description : "")
        .toContain("omitted for Bearer authentication");
    }
  });

  it("describes exact-one-base semantics, closed nested sources, and input limits", () => {
    const document = buildOpenApiDocument("https://rfp.example");
    const create = asObject(document.components.schemas.CreateRunRequest);
    const documents = asObject(asObject(create.properties).documents);
    expect(create).toMatchObject({
      additionalProperties: false,
      required: ["documents"]
    });
    expect(documents).toMatchObject({
      minItems: 1,
      maxItems: 5,
      minContains: 1,
      maxContains: 1,
      items: { $ref: "#/components/schemas/RunDocumentInput" }
    });

    const documentInput = asObject(document.components.schemas.RunDocumentInput);
    expect(documentInput).toMatchObject({
      additionalProperties: false,
      required: ["role", "source"]
    });
    expect(document.components.schemas.UrlSource).toMatchObject({ additionalProperties: false });
    expect(document.components.schemas.UploadSource).toMatchObject({ additionalProperties: false });

    const presign = asObject(document.components.schemas.PresignUploadRequest);
    const presignProperties = asObject(presign.properties);
    expect(presign).toMatchObject({ additionalProperties: false });
    expect(presignProperties.size_bytes).toMatchObject({
      type: "integer",
      exclusiveMinimum: 0,
      maximum: 25 * 1024 * 1024
    });
    expect(presignProperties.sha256).toMatchObject({ pattern: "^[a-f0-9]{64}$" });
    expect(presignProperties.filename).toMatchObject({
      minLength: 1,
      maxLength: 200,
      pattern: "^(?!.*[\\\\/]).+\\.[pP][dD][fF]$"
    });
  });

  it("keeps generated response/error schemas closed and complete", () => {
    const document = buildOpenApiDocument("https://rfp.example");
    expect(document.components.schemas.RunStatus).toEqual(zodJsonSchema(RunStatusResponseSchema));
    expect(document.components.schemas.QuestionRequest).toEqual(zodJsonSchema(QuestionRequestSchema));
    expect(document.components.schemas.QuestionResponse).toEqual(zodJsonSchema(QuestionResponseSchema));
    expect(document.components.schemas.ApiError).toEqual(zodJsonSchema(ApiErrorSchema));
    expect(document.components.schemas.AnalysisResult).toEqual(zodJsonSchema(AnalysisResultSchema));

    const status = asObject(document.components.schemas.RunStatus);
    const statusProperties = asObject(status.properties);
    expect(status).toMatchObject({ additionalProperties: false });
    expect(asObject(statusProperties.status).enum).toEqual(runStatuses);
    expect(asObject(statusProperties.stage).enum).toEqual(runStatuses);
    expect(asObject(statusProperties.progress)).toMatchObject({ minimum: 0, maximum: 100 });

    const error = asObject(document.components.schemas.ApiError);
    const errorEnvelope = asObject(asObject(error.properties).error);
    const errorProperties = asObject(errorEnvelope.properties);
    expect(error).toMatchObject({ additionalProperties: false, required: ["error"] });
    expect(errorEnvelope).toMatchObject({ additionalProperties: false });
    expect(asObject(errorProperties.code).enum).toEqual(errorCodes);

    const question = asObject(document.components.schemas.QuestionResponse);
    const answerabilityBranches = question.oneOf as unknown[];
    const branch = (answerability: string) => answerabilityBranches
      .map(asObject)
      .find((candidate) => {
        const properties = asObject(candidate.properties);
        return asObject(properties.answerability).const === answerability;
      });
    const answeredCitations = asObject(asObject(branch("answered")?.properties).citations);
    const partialCitations = asObject(asObject(branch("partial")?.properties).citations);
    const notFoundCitations = asObject(asObject(branch("not_found")?.properties).citations);
    expect(answeredCitations.minItems).toBe(1);
    expect(partialCitations.minItems).toBeUndefined();
    expect(notFoundCitations.maxItems).toBe(0);

    const analysis = asObject(document.components.schemas.AnalysisResult);
    const analysisRequired = analysis.required as string[];
    expect(analysis).toMatchObject({ additionalProperties: false });
    expect(analysisRequired).toEqual(expect.arrayContaining([
      "schema_version",
      "source_scope",
      "package_completeness",
      "document_manifest",
      "summary",
      "claims",
      "requirements",
      "evaluation",
      "risks",
      "conflicts",
      "clarification_questions",
      "decision_readiness",
      "blocking_unknowns",
      "quality",
      "costs",
      "generated_at",
      "expires_at"
    ]));
    const summary = asObject(asObject(analysis.properties).summary);
    const costs = asObject(asObject(analysis.properties).costs);
    expect(summary).toMatchObject({ additionalProperties: false });
    expect(costs).toMatchObject({ additionalProperties: false });
  });

  it("publishes the runtime status-code matrix and cleanup fail-closed behavior", () => {
    const document = buildOpenApiDocument("https://rfp.example");
    expect(Object.keys(document.paths["/api/v1/runs"].post.responses).sort()).toEqual([
      "200", "202", "400", "401", "402", "403", "409", "413", "422", "429", "500", "503"
    ]);
    expect(Object.keys(document.paths["/api/v1/runs/{run_id}/analysis"].get.responses).sort()).toEqual([
      "200", "202", "401", "404", "409", "410", "500", "503"
    ]);
    expect(document.paths["/api/v1/runs/{run_id}/analysis"].get.responses["202"])
      .toMatchObject({ content: { "application/json": { schema: { $ref: "#/components/schemas/RunStatus" } } } });
    expect(document.paths["/api/v1/runs/{run_id}/analysis"].get.description)
      .toContain("cleanup_pending");
    expect(document.paths["/api/v1/runs/{run_id}"].delete.responses["503"].description)
      .toContain("cleanup");
    expect(document.paths["/api/v1/runs"].post.responses["429"])
      .toHaveProperty("headers.Retry-After");
  });

  it("returns the frozen analysis schema from the Edmonton sample route", async () => {
    const response = await getEdmontonSample();
    expect(response.status).toBe(200);
    expect(AnalysisResultSchema.parse(await response.json()).schema_version).toBe("1.0");
  });

  it("accepts empty citations for not-found/partial Q&A but requires support for answered", () => {
    expect(QuestionResponseSchema.safeParse({
      answerability: "not_found",
      answer: "The supplied documents do not answer that question.",
      citations: [],
      warning: "No external sources were consulted."
    }).success).toBe(true);
    expect(QuestionResponseSchema.safeParse({
      answerability: "partial",
      answer: "The document contains related wording but no exact verified passage.",
      citations: [],
      warning: "This may not fully answer the question."
    }).success).toBe(true);
    expect(QuestionResponseSchema.safeParse({
      answerability: "answered",
      answer: "The requirement is mandatory.",
      citations: [citation],
      warning: null
    }).success).toBe(true);
    expect(QuestionResponseSchema.safeParse({
      answerability: "answered",
      answer: "Unsupported definitive answer.",
      citations: [],
      warning: null
    }).success).toBe(false);
    expect(QuestionResponseSchema.safeParse({
      answerability: "not_found",
      answer: "No answer.",
      citations: [citation],
      warning: null
    }).success).toBe(false);
  });

  it("rejects malformed or open-ended create, presign, status, and error payloads", () => {
    const base = { role: "base", source: { type: "url", url: "https://canadabuys.canada.ca/base.pdf" } };
    const amendment = { role: "amendment", source: { type: "url", url: "https://canadabuys.canada.ca/a1.pdf" } };
    expect(CreateRunRequestSchema.safeParse({ documents: [base] }).success).toBe(true);
    expect(CreateRunRequestSchema.safeParse({ documents: [amendment] }).success).toBe(false);
    expect(CreateRunRequestSchema.safeParse({ documents: [base, base] }).success).toBe(false);
    expect(CreateRunRequestSchema.safeParse({ documents: [base], unexpected: true }).success).toBe(false);
    expect(CreateRunRequestSchema.safeParse({ documents: [base, amendment, amendment, amendment, amendment, amendment] }).success).toBe(false);

    const presign = {
      filename: "request.pdf",
      size_bytes: 1024,
      sha256: "b".repeat(64)
    };
    expect(PresignUploadRequestSchema.safeParse(presign).success).toBe(true);
    expect(PresignUploadRequestSchema.safeParse({ ...presign, filename: "request.docx" }).success).toBe(false);
    expect(PresignUploadRequestSchema.safeParse({ ...presign, size_bytes: 25 * 1024 * 1024 + 1 }).success).toBe(false);
    expect(PresignUploadRequestSchema.safeParse({ ...presign, debug: true }).success).toBe(false);

    const status = {
      run_id: crypto.randomUUID(),
      status: "cleanup_pending",
      stage: "purging_source",
      progress: 96,
      created_at: "2026-09-02T00:00:00.000Z",
      updated_at: "2026-09-02T00:01:00.000Z",
      expires_at: "2026-09-03T00:00:00.000Z",
      cleanup_confirmed: false,
      cost_micro_usd: 10,
      cost_accounting_status: "estimated_pending",
      error: null
    };
    expect(RunStatusResponseSchema.safeParse(status).success).toBe(true);
    expect(RunStatusResponseSchema.safeParse({ ...status, progress: 101 }).success).toBe(false);
    expect(ApiErrorSchema.safeParse({
      error: {
        code: "SOURCE_CLEANUP_PENDING",
        message: "Cleanup is not confirmed.",
        retryable: true,
        request_id: crypto.randomUUID()
      }
    }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({
      error: {
        code: "NOT_A_REAL_CODE",
        message: "Unknown error.",
        retryable: false,
        request_id: crypto.randomUUID()
      }
    }).success).toBe(false);
  });

  it("creates and idempotently replays a run with frozen response/status shapes", async () => {
    const store = new InMemoryRunStore();
    const budget = new InMemoryBudgetGuard(config);
    const principal = { id: "guest:contract", quotaKey: "ip:contract", kind: "guest" as const };
    const input = {
      documents: [{ role: "base", source: { type: "url", url: "https://canadabuys.canada.ca/tender.pdf" } }]
    };
    const schedule = vi.fn(async () => null);
    const first = await createRun(input, principal, "contract-request-1", {
      config, store, budget, schedule
    });
    const replay = await createRun(input, principal, "contract-request-1", {
      config, store, budget, schedule
    });
    expect(CreateRunResponseSchema.parse(first.response).run_id).toBe(first.record.id);
    expect(first.record.reservedMicroUsd).toBe(config.MAX_RUN_COST_MICRO_USD);
    expect(replay.created).toBe(false);
    expect(replay.record.id).toBe(first.record.id);
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(RunStatusResponseSchema.parse(toRunStatusResponse(first.record)).cleanup_confirmed).toBe(false);
    await expect(createRun(input, principal, "contract-request-2", {
      config, store, budget, schedule: async () => null
    })).rejects.toMatchObject({ code: "RATE_LIMITED", httpStatus: 429 });
  });

  it("resumes admission when a crash left an idempotent run queued before scheduling", async () => {
    const store = new InMemoryRunStore();
    const budget = new InMemoryBudgetGuard(config);
    const principal = { id: "guest:crash", quotaKey: "ip:crash", kind: "guest" as const };
    const input = {
      documents: [{ role: "base" as const, source: {
        type: "url" as const,
        url: "https://canadabuys.canada.ca/crash.pdf"
      } }]
    };
    const stranded = await store.create({
      ownerId: principal.id,
      quotaKey: principal.quotaKey,
      input,
      idempotencyKey: "crashed-admission",
      reservedMicroUsd: 250_000
    });
    const schedule = vi.fn(async () => "workflow-recovered");

    const replay = await createRun(input, principal, "crashed-admission", {
      config, store, budget, schedule
    });

    expect(replay.created).toBe(false);
    expect(replay.record.id).toBe(stranded.record.id);
    expect(replay.record.workflowRunId).toBe("workflow-recovered");
    expect(replay.record.reservedMicroUsd).toBe(config.MAX_RUN_COST_MICRO_USD);
    expect(schedule).toHaveBeenCalledExactlyOnceWith(stranded.record.id);
    expect((await store.get(stranded.record.id))?.workflowRunId).toBe("workflow-recovered");
  });

  it("uses a single-writer admission lease for concurrent idempotent creates", async () => {
    const store = new InMemoryRunStore();
    const budget = new InMemoryBudgetGuard(config);
    const principal = { id: "guest:admission-race", quotaKey: "ip:admission-race", kind: "guest" as const };
    const input = {
      documents: [{ role: "base", source: { type: "url", url: "https://canadabuys.canada.ca/race.pdf" } }]
    };
    let entered!: () => void;
    let release!: () => void;
    const scheduleEntered = new Promise<void>((resolve) => { entered = resolve; });
    const scheduleBlocked = new Promise<void>((resolve) => { release = resolve; });
    const schedule = vi.fn(async () => {
      entered();
      await scheduleBlocked;
      throw new Error("scheduler failed after the peer replayed");
    });

    const first = createRun(input, principal, "same-request", { config, store, budget, schedule });
    await scheduleEntered;
    const replay = await createRun(input, principal, "same-request", { config, store, budget, schedule });
    expect(replay.created).toBe(false);
    expect(replay.record.status).toBe("queued");
    release();
    await expect(first).resolves.toMatchObject({
      record: { id: replay.record.id, status: "queued" }
    });

    expect(schedule).toHaveBeenCalledOnce();
    expect(await store.get(replay.record.id)).toMatchObject({
      id: replay.record.id, status: "queued", cleanupConfirmed: false
    });
  });
});
