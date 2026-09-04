import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import { getConfig } from "@/lib/config";
import {
  estimateOpenAiBatchFailureCostMicroUsd,
  mergeDrafts,
  ModelBatchError,
  OPENAI_API_BASE_URL,
  OPENAI_EXTRACTION_PHASE_TIMEOUT_MS,
  OPENAI_MIN_PAID_BATCH_WINDOW_MS,
  OPENAI_QUALITY_BATCH_MAX_BYTES,
  OPENAI_TARGET_MAX_SEQUENTIAL_BATCHES,
  OpenAIResponsesAdapter,
  prepareExtractionInputs,
  type PaidExtractionCallbacks
} from "@/lib/providers/openai";

function emptyDraft(): DraftAnalysis {
  return {
    summary: {
      title: "", solicitation_number: null, issuer: null, closing_date: null,
      overview: "", scope: [], submission_method: null, current_selection_method: null
    },
    claims: [],
    requirements: [],
    evaluation: { rules: [] },
    risks: [],
    clarification_questions: [],
    blocking_unknowns: []
  };
}

function fakeClient(options: {
  count?: (request: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{
    input_tokens: number;
    object: "response.input_tokens";
  }>;
  parse: (request: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
}) {
  return {
    beta: {
      responses: {
        inputTokens: {
          count: options.count ?? (async () => ({
            input_tokens: 100,
            object: "response.input_tokens" as const
          }))
        }
      }
    },
    responses: { parse: options.parse }
  } as unknown as OpenAI;
}

function testConfig(overrides: Record<string, string> = {}) {
  return getConfig({
    NODE_ENV: "test",
    OPENAI_API_KEY: "test-key",
    SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough",
    ...overrides
  });
}

const sourceDocument = {
  document_sha256: "a".repeat(64),
  document_name: "source.pdf",
  role: "base" as const,
  amendment_number: null,
  parsed_markdown: "Untrusted document text",
  evidence_chunks: [{
    chunkId: "opaque",
    documentSha256: "a".repeat(64),
    text: "Untrusted document text"
  }]
};

const noopPaidCallbacks: PaidExtractionCallbacks = {
  beforePaidBatchDispatch: async () => {},
  settlePaidBatch: async () => {}
};

describe("OpenAI Responses structured output adapter", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ignores an adversarial ambient OPENAI_BASE_URL and pins the official API", () => {
    vi.stubEnv("OPENAI_BASE_URL", "https://credential-sink.example/v1");
    const adapter = new OpenAIResponsesAdapter(testConfig());
    const client = (adapter as unknown as { client: { baseURL: string } }).client;
    expect(client.baseURL).toBe(OPENAI_API_BASE_URL);
    expect(client.baseURL).toBe("https://api.openai.com/v1");
  });

  it("counts the complete structured request before responses.parse and disables tools/storage", async () => {
    let countBody: Record<string, unknown> | undefined;
    let parseBody: Record<string, unknown> | undefined;
    const events: string[] = [];
    const client = fakeClient({
      count: async (request) => {
        events.push("count");
        countBody = request;
        return { input_tokens: 10, object: "response.input_tokens" };
      },
      parse: async (request) => {
        events.push("parse");
        parseBody = request;
        return {
          id: "response-1",
          output_parsed: { ...emptyDraft(), summary: { ...emptyDraft().summary, title: "Tender" } },
          usage: { input_tokens: 10, output_tokens: 5 }
        };
      }
    });
    const adapter = new OpenAIResponsesAdapter(testConfig(), client);
    const result = await adapter.extract([sourceDocument], {
      beforePaidBatchDispatch: async (plan) => {
        events.push("ledger-pending");
        expect(plan).toMatchObject({ batchIndex: 0, totalBatches: 1 });
      },
      settlePaidBatch: async (settlement) => {
        events.push("ledger-settled");
        expect(settlement).toMatchObject({ batchIndex: 0, status: "succeeded" });
      }
    });
    expect(result.analysis.summary.title).toBe("Tender");
    expect(events).toEqual(["count", "ledger-pending", "parse", "ledger-settled"]);
    expect(countBody).toMatchObject({ model: "gpt-5.4-mini", tools: [] });
    expect(countBody?.text).toBeTypeOf("object");
    expect(parseBody).toMatchObject({ model: "gpt-5.4-mini", store: false, tools: [] });
    expect(parseBody?.max_output_tokens).toBe(50_000);
    expect(parseBody?.text).toBeTypeOf("object");
    expect(String(parseBody?.instructions)).toMatch(/never instructions/i);
    expect(String(parseBody?.instructions)).toMatch(/never generate or infer a page number/i);
    expect(String(parseBody?.instructions)).toMatch(/read every source fragment/i);
    expect(String(parseBody?.instructions)).toMatch(/copy the smallest complete source value or clause verbatim/i);
    expect(String(parseBody?.instructions)).toMatch(/generic statement.*mandatory_gate rule/i);
    expect(String(parseBody?.instructions)).toMatch(/do not emit package-level absence statements/i);
  });

  it("uses recall-sized batches so late mandatory tables are not buried in one huge request", () => {
    const marker = "ANNEX D MANDATORY CRITERIA M1 bidder must provide evidence";
    const markdown = `${"front matter requirement text ".repeat(4_650)}\n${marker}\n${"form text ".repeat(1_500)}`;
    const inputs = prepareExtractionInputs([{
      ...sourceDocument,
      parsed_markdown: markdown
    }], testConfig());

    expect(inputs.length).toBeGreaterThanOrEqual(3);
    expect(inputs.every((input) => new TextEncoder().encode(input).byteLength <= OPENAI_QUALITY_BATCH_MAX_BYTES))
      .toBe(true);
    expect(inputs.filter((input) => input.includes(marker))).toHaveLength(1);
    expect(inputs[0]).toMatch(/batch 1\/\d+\. This is not the whole package/i);
    const inputSizes = inputs.map((input) => new TextEncoder().encode(input).byteLength);
    expect(Math.min(...inputSizes) / Math.max(...inputSizes)).toBeGreaterThan(0.65);
    const markerInput = inputs.find((input) => input.includes(marker));
    expect(markerInput).toBeDefined();
    const markerByteOffset = new TextEncoder().encode(markerInput!.slice(0, markerInput!.indexOf(marker))).byteLength;
    const markerInputBytes = new TextEncoder().encode(markerInput!).byteLength;
    expect(markerByteOffset / markerInputBytes).toBeLessThan(0.85);
  });

  it.each([
    ["negative", -1, 5],
    ["fractional", 10.5, 5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1, 5],
    ["NaN", Number.NaN, 5],
    ["infinite", 10, Number.POSITIVE_INFINITY]
  ])("retains the pending maximum for %s response usage", async (
    _label,
    reportedInputTokens,
    reportedOutputTokens
  ) => {
    let maximumEstimatedCostMicroUsd = 0;
    let settledEstimatedCostMicroUsd = 0;
    const client = fakeClient({
      count: async () => ({ input_tokens: 100, object: "response.input_tokens" }),
      parse: async () => ({
        id: "response-invalid-usage",
        output_parsed: emptyDraft(),
        usage: {
          input_tokens: reportedInputTokens,
          output_tokens: reportedOutputTokens
        }
      })
    });
    const adapter = new OpenAIResponsesAdapter(testConfig(), client);

    const result = await adapter.extract([sourceDocument], {
      beforePaidBatchDispatch: async (plan) => {
        maximumEstimatedCostMicroUsd = plan.maximumEstimatedCostMicroUsd;
      },
      settlePaidBatch: async (settlement) => {
        settledEstimatedCostMicroUsd = settlement.estimatedCostMicroUsd;
      }
    });

    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
    expect(maximumEstimatedCostMicroUsd).toBeGreaterThan(0);
    expect(settledEstimatedCostMicroUsd).toBe(maximumEstimatedCostMicroUsd);
  });

  it("blocks every paid parse when durable accounting callbacks are absent", async () => {
    let parseCalls = 0;
    const client = fakeClient({
      parse: async () => {
        parseCalls += 1;
        throw new Error("must not dispatch");
      }
    });
    const adapter = new OpenAIResponsesAdapter(testConfig(), client);

    await expect(adapter.extract([sourceDocument]))
      .rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    expect(parseCalls).toBe(0);
  });

  it("fails before token counting or generation when serialized input exceeds its cap", async () => {
    let countCalls = 0;
    let parseCalls = 0;
    const client = fakeClient({
      count: async () => {
        countCalls += 1;
        return { input_tokens: 1, object: "response.input_tokens" };
      },
      parse: async () => {
        parseCalls += 1;
        throw new Error("not reached");
      }
    });
    const adapter = new OpenAIResponsesAdapter(testConfig({
      OPENAI_MAX_SERIALIZED_INPUT_BYTES: "1000"
    }), client);
    await expect(adapter.extract([{
      ...sourceDocument,
      parsed_markdown: "x".repeat(2_000)
    }], noopPaidCallbacks)).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(countCalls).toBe(0);
    expect(parseCalls).toBe(0);
  });

  it("accepts a dense 300-page package, uses Monid Markdown once, and preflights every batch first", async () => {
    const countRequests: Record<string, unknown>[] = [];
    const parseRequests: Record<string, unknown>[] = [];
    const events: string[] = [];
    const client = fakeClient({
      count: async (request) => {
        events.push("count");
        countRequests.push(request);
        const bytes = new TextEncoder().encode(String(request.input)).byteLength;
        return {
          input_tokens: Math.ceil(bytes / 4) + 1_000,
          object: "response.input_tokens"
        };
      },
      parse: async (request) => {
        events.push("parse");
        parseRequests.push(request);
        return {
          id: `response-${parseRequests.length}`,
          output_parsed: emptyDraft(),
          usage: { input_tokens: 30_000, output_tokens: 100 }
        };
      }
    });
    const pageTexts = Array.from({ length: 300 }, (_, index) =>
      `page ${index + 1} ` + "requirement text ".repeat(120)
    );
    const documentSha = "c".repeat(64);
    const adapter = new OpenAIResponsesAdapter(testConfig(), client);
    await expect(adapter.extract([{
      document_sha256: documentSha,
      document_name: "300-pages.pdf",
      role: "base",
      amendment_number: null,
      parsed_markdown: pageTexts.join("\n"),
      evidence_chunks: [{
        chunkId: "page-index-only-marker",
        documentSha256: documentSha,
        text: "must-not-be-duplicated"
      }]
    }], noopPaidCallbacks)).resolves.toMatchObject({ inputTokens: expect.any(Number), outputTokens: expect.any(Number) });
    expect(parseRequests.length).toBeGreaterThan(1);
    expect(parseRequests.length).toBeLessThanOrEqual(OPENAI_TARGET_MAX_SEQUENTIAL_BATCHES);
    expect(countRequests).toHaveLength(parseRequests.length);
    expect(events.slice(0, countRequests.length)).toEqual(Array(countRequests.length).fill("count"));
    expect(parseRequests.reduce((sum, request) => sum + Number(request.max_output_tokens), 0))
      .toBeLessThanOrEqual(50_000);
    const serialized = parseRequests.map((request) => String(request.input)).join("\n");
    expect(new TextEncoder().encode(serialized).byteLength).toBeGreaterThan(500_000);
    expect(serialized.match(/page 300 /g)).toHaveLength(1);
    expect(serialized).not.toContain("page-index-only-marker");
    expect(serialized).not.toContain("must-not-be-duplicated");
  });

  it("rejects an exact-token overage before any generation", async () => {
    let parseCalls = 0;
    const client = fakeClient({
      count: async () => ({ input_tokens: 320_001, object: "response.input_tokens" }),
      parse: async () => {
        parseCalls += 1;
        throw new Error("not reached");
      }
    });
    const adapter = new OpenAIResponsesAdapter(testConfig(), client);
    await expect(adapter.extract([sourceDocument], noopPaidCallbacks))
      .rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(parseCalls).toBe(0);
  });

  it("retains completed batch usage and response IDs when a later batch fails", async () => {
    let parseCalls = 0;
    const startedBatches: number[] = [];
    const settledBatches: Array<{ batchIndex: number; status: string }> = [];
    const client = fakeClient({
      count: async () => ({ input_tokens: 1_000, object: "response.input_tokens" }),
      parse: async () => {
        parseCalls += 1;
        if (parseCalls === 2) throw new Error("provider interrupted");
        return {
          id: "response-paid-1",
          output_parsed: emptyDraft(),
          usage: { input_tokens: 900, output_tokens: 75 }
        };
      }
    });
    const adapter = new OpenAIResponsesAdapter(testConfig(), client);
    const failure = await adapter.extract([{
      ...sourceDocument,
      parsed_markdown: "paid batch text ".repeat(11_000)
    }], {
      beforePaidBatchDispatch: async (plan) => {
        startedBatches.push(plan.batchIndex);
      },
      settlePaidBatch: async (settlement) => {
        settledBatches.push({ batchIndex: settlement.batchIndex, status: settlement.status });
      }
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: "ModelBatchError",
      retryable: false,
      completedResponseIds: ["response-paid-1"],
      completedInputTokens: 900,
      completedOutputTokens: 75,
      attemptedBatches: 2,
      preflightInputTokens: expect.arrayContaining([1_000, 1_000]),
      estimatedAttemptedInputTokens: 2_000
    } satisfies Partial<ModelBatchError>);
    expect(failure).toBeInstanceOf(ModelBatchError);
    expect((failure as ModelBatchError).estimatedAttemptedOutputTokens).toBe(
      75 + Math.floor(50_000 / (failure as ModelBatchError).preflightInputTokens.length)
    );
    expect(estimateOpenAiBatchFailureCostMicroUsd(failure as ModelBatchError))
      .toBeGreaterThan(900 * 0.75 + 75 * 4.5);
    expect(startedBatches).toEqual([0, 1]);
    expect(settledBatches).toEqual([
      { batchIndex: 0, status: "succeeded" },
      { batchIndex: 1, status: "failed" }
    ]);
  });

  it("enforces one aggregate extraction deadline across preflight and sequential batches", async () => {
    let clockMs = 0;
    let parseCalls = 0;
    let plannedBatches = 0;
    const parseOptions: Record<string, unknown>[] = [];
    const client = fakeClient({
      count: async (_request, options) => {
        plannedBatches += 1;
        expect(options).toMatchObject({ timeout: OPENAI_EXTRACTION_PHASE_TIMEOUT_MS, maxRetries: 0 });
        return { input_tokens: 1_000, object: "response.input_tokens" };
      },
      parse: async (_request, options) => {
        parseCalls += 1;
        parseOptions.push(options ?? {});
        clockMs = OPENAI_EXTRACTION_PHASE_TIMEOUT_MS - OPENAI_MIN_PAID_BATCH_WINDOW_MS + 1;
        return {
          id: "response-before-deadline",
          output_parsed: emptyDraft(),
          usage: { input_tokens: 900, output_tokens: 75 }
        };
      }
    });
    const adapter = new OpenAIResponsesAdapter(testConfig(), client, () => clockMs);
    const failure = await adapter.extract([{
      ...sourceDocument,
      parsed_markdown: "multi batch deadline text ".repeat(11_000)
    }], noopPaidCallbacks).catch((error: unknown) => error);

    expect(parseCalls).toBe(1);
    expect(parseOptions).toEqual([{
      timeout: OPENAI_EXTRACTION_PHASE_TIMEOUT_MS -
        ((plannedBatches - 1) * OPENAI_MIN_PAID_BATCH_WINDOW_MS),
      maxRetries: 0
    }]);
    expect(failure).toBeInstanceOf(ModelBatchError);
    expect(failure).toMatchObject({ attemptedBatches: 1, completedResponseIds: ["response-before-deadline"] });
  });

  it("revalidates the paid-call window after the durable ledger write", async () => {
    let clockMs = 0;
    let parseCalls = 0;
    let settlement: { status: string; estimatedCostMicroUsd: number } | undefined;
    const client = fakeClient({
      count: async () => ({ input_tokens: 1_000, object: "response.input_tokens" }),
      parse: async () => {
        parseCalls += 1;
        throw new Error("must not dispatch with a stale timeout");
      }
    });
    const adapter = new OpenAIResponsesAdapter(testConfig(), client, () => clockMs);

    const failure = await adapter.extract([sourceDocument], {
      beforePaidBatchDispatch: async () => {
        clockMs = OPENAI_EXTRACTION_PHASE_TIMEOUT_MS - OPENAI_MIN_PAID_BATCH_WINDOW_MS + 1;
      },
      settlePaidBatch: async (event) => {
        settlement = event;
      }
    }).catch((error: unknown) => error);

    expect(parseCalls).toBe(0);
    expect(settlement).toMatchObject({ status: "failed", estimatedCostMicroUsd: 0 });
    expect(failure).toBeInstanceOf(ModelBatchError);
    expect(failure).toMatchObject({
      attemptedBatches: 0,
      completedResponseIds: [],
      retryable: true
    });
  });

  it("uses a supplied Workflow deadline while reserving time for every later batch", async () => {
    let clockMs = 15_000;
    let plannedBatches = 0;
    let parseCalls = 0;
    const absoluteDeadlineMs = 270_000;
    const parseOptions: Record<string, unknown>[] = [];
    const client = fakeClient({
      count: async (_request, options) => {
        plannedBatches += 1;
        expect(options).toMatchObject({ timeout: absoluteDeadlineMs - clockMs, maxRetries: 0 });
        return { input_tokens: 1_000, object: "response.input_tokens" };
      },
      parse: async (_request, options) => {
        parseCalls += 1;
        parseOptions.push(options ?? {});
        clockMs = absoluteDeadlineMs - OPENAI_MIN_PAID_BATCH_WINDOW_MS + 1;
        return {
          id: "response-workflow-deadline",
          output_parsed: emptyDraft(),
          usage: { input_tokens: 900, output_tokens: 75 }
        };
      }
    });
    const adapter = new OpenAIResponsesAdapter(
      testConfig(),
      client,
      () => clockMs,
      absoluteDeadlineMs
    );
    const failure = await adapter.extract([{
      ...sourceDocument,
      parsed_markdown: "workflow deadline text ".repeat(11_000)
    }], noopPaidCallbacks).catch((error: unknown) => error);

    expect(parseCalls).toBe(1);
    expect(parseOptions).toEqual([{
      timeout: absoluteDeadlineMs - 15_000 -
        ((plannedBatches - 1) * OPENAI_MIN_PAID_BATCH_WINDOW_MS),
      maxRetries: 0
    }]);
    expect(failure).toMatchObject({
      name: "ModelBatchError",
      attemptedBatches: 1,
      retryable: false
    });
  });

  it("rejects an insufficient supplied deadline before any paid dispatch", async () => {
    let paidDispatches = 0;
    let parseCalls = 0;
    const client = fakeClient({
      count: async () => ({ input_tokens: 1_000, object: "response.input_tokens" }),
      parse: async () => {
        parseCalls += 1;
        throw new Error("must not dispatch");
      }
    });
    const adapter = new OpenAIResponsesAdapter(
      testConfig(),
      client,
      () => 0,
      OPENAI_MIN_PAID_BATCH_WINDOW_MS - 1
    );

    await expect(adapter.extract([sourceDocument], {
      beforePaidBatchDispatch: async () => {
        paidDispatches += 1;
      },
      settlePaidBatch: async () => {}
    })).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE", retryable: true });
    expect(paidDispatches).toBe(0);
    expect(parseCalls).toBe(0);
  });

  it("rejects a batch plan that cannot fit before making any paid parse request", async () => {
    let countCalls = 0;
    let parseCalls = 0;
    const client = fakeClient({
      count: async () => {
        countCalls += 1;
        return { input_tokens: 1_000, object: "response.input_tokens" };
      },
      parse: async () => {
        parseCalls += 1;
        throw new Error("must not make a paid request");
      }
    });
    const adapter = new OpenAIResponsesAdapter(testConfig({
      OPENAI_MAX_REQUEST_INPUT_BYTES: "15000"
    }), client);

    await expect(adapter.extract([{
      ...sourceDocument,
      parsed_markdown: "oversized batch plan text ".repeat(12_000)
    }], noopPaidCallbacks)).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    expect(countCalls).toBeGreaterThan(16);
    expect(parseCalls).toBe(0);
  });

  it("merges independently sourced evaluation rules across batches", () => {
    const first = emptyDraft();
    first.evaluation = {
      rules: [{
        id: "mandatory-base", field: "mandatory_gate", topic: "mandatory gate",
        document_sha256: "a".repeat(64), amendment_number: null, effect: "add", value: "true",
        citations: [{ document_sha256: "a".repeat(64), chunk_id: null,
          evidence_quote: "Mandatory gate applies", section: null }]
      }]
    };
    const second = emptyDraft();
    second.evaluation = {
      rules: [{
        id: "technical-amendment", field: "technical_weight", topic: "technical weight",
        document_sha256: "b".repeat(64), amendment_number: "001", effect: "replace", value: "70",
        citations: [{ document_sha256: "b".repeat(64), chunk_id: null,
          evidence_quote: "70% technical and 30% financial", section: null }]
      }]
    };
    const merged = mergeDrafts([first, second]);
    expect(merged.evaluation.rules).toEqual([
      first.evaluation.rules[0],
      second.evaluation.rules[0]
    ]);
  });

  it("merges summary fields without letting a later body batch erase cover identity", () => {
    const cover = emptyDraft();
    cover.summary = {
      title: "Repair & Maintenance on various File Bays",
      solicitation_number: "100022184-A",
      issuer: "Employment and Social Development Canada",
      closing_date: "June 19, 2023",
      overview: "Cover summary",
      scope: [],
      submission_method: "email",
      current_selection_method: null
    };
    const body = emptyDraft();
    body.summary = {
      title: "",
      solicitation_number: null,
      issuer: null,
      closing_date: null,
      overview: "A longer body overview that previously won the whole-summary tie break.",
      scope: ["Preventative maintenance"],
      submission_method: null,
      current_selection_method: "lowest evaluated price"
    };

    expect(mergeDrafts([cover, body]).summary).toEqual({
      title: "Repair & Maintenance on various File Bays",
      solicitation_number: "100022184-A",
      issuer: "Employment and Social Development Canada",
      closing_date: "June 19, 2023",
      overview: "A longer body overview that previously won the whole-summary tie break.",
      scope: ["Preventative maintenance"],
      submission_method: "email",
      current_selection_method: "lowest evaluated price"
    });
  });

  it("assigns content-bound identities when independent batches reuse a model ID", () => {
    const first = emptyDraft();
    first.risks = [{
      id: "risk-1", topic: "late bid", document_sha256: "a".repeat(64), amendment_number: null,
      effect: "add", severity: "high", category: "submission", finding: "Late bids are rejected.",
      impact: "Submission can fail.", recommended_action: "Submit early.", citations: [{
        document_sha256: "a".repeat(64), chunk_id: null, evidence_quote: "Late bids are rejected.", section: null
      }]
    }];
    const second = emptyDraft();
    second.risks = [{
      id: "risk-1", topic: "insurance", document_sha256: "b".repeat(64), amendment_number: "001",
      effect: "add", severity: "medium", category: "financial", finding: "Insurance costs may rise.",
      impact: "Pricing may change.", recommended_action: "Review pricing.", citations: [{
        document_sha256: "b".repeat(64), chunk_id: null, evidence_quote: "Insurance costs may rise.", section: null
      }]
    }];

    const merged = mergeDrafts([first, second]);
    expect(new Set(merged.risks.map((risk) => risk.id)).size).toBe(2);
    expect(merged.risks.every((risk) => risk.id.startsWith("risk-1~"))).toBe(true);
    expect(merged.risks.map((risk) => [risk.finding, risk.citations[0].document_sha256])).toEqual([
      ["Late bids are rejected.", "a".repeat(64)],
      ["Insurance costs may rise.", "b".repeat(64)]
    ]);
  });
});
