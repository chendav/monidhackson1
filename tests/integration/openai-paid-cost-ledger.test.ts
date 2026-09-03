import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import { getConfig } from "@/lib/config";
import { OpenAIResponsesAdapter } from "@/lib/providers/openai";
import {
  markPaidCostAttemptStarted,
  openAiBatchAttemptId,
  settlePaidCostAttempt
} from "@/lib/runs/paid-cost-ledger";
import { InMemoryRunStore, PROCESSING_LEASE_MS } from "@/lib/runs/store";
import { toRunStatusResponse } from "@/lib/runs/types";
import { InMemoryBudgetGuard } from "@/lib/security/budget";

function emptyDraft(): DraftAnalysis {
  return {
    summary: {
      title: "Tender", solicitation_number: null, issuer: null, closing_date: null,
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

describe("durable OpenAI paid-batch accounting", () => {
  it("atomically replaces a pending batch with its terminal cost and rejects duplicate dispatch", async () => {
    const now = new Date("2026-09-03T17:00:00.000Z");
    const store = new InMemoryRunStore();
    const created = (await store.create({
      ownerId: "guest:openai-settlement",
      quotaKey: "ip:openai-settlement",
      input: { documents: [{
        role: "base",
        source: { type: "url", url: "https://canadabuys.canada.ca/source.pdf" }
      }] },
      idempotencyKey: null,
      reservedMicroUsd: 2_000_000,
      now
    })).record;
    const claimed = await store.claimProcessing(created.id, now);
    const claim = { leaseId: claimed!.leaseId, fence: claimed!.fence };
    const attemptId = openAiBatchAttemptId(created.id, 0);
    const pending = {
      attempt_id: attemptId,
      provider: "openai" as const,
      operation: "responses.parse.structured_extraction",
      status: "pending" as const,
      actual_micro_usd: null,
      estimated_micro_usd: 100_000,
      latency_ms: 0,
      retry_of: null,
      cost_provenance: null
    };
    await markPaidCostAttemptStarted({
      store,
      runId: created.id,
      event: pending,
      remainingCommitmentMicroUsd: 200_000,
      maximumRunCostMicroUsd: 2_000_000,
      claim,
      now
    });
    await expect(markPaidCostAttemptStarted({
      store,
      runId: created.id,
      event: pending,
      remainingCommitmentMicroUsd: 200_000,
      maximumRunCostMicroUsd: 2_000_000,
      claim,
      now
    })).rejects.toMatchObject({ code: "ANALYSIS_INCOMPLETE" });

    await settlePaidCostAttempt({
      store,
      runId: created.id,
      event: { ...pending, status: "failed", estimated_micro_usd: 40_000, latency_ms: 25 },
      remainingCommitmentMicroUsd: 200_000,
      maximumRunCostMicroUsd: 2_000_000,
      claim,
      now
    });

    const settled = (await store.get(created.id))!;
    expect(settled.costs).toEqual([expect.objectContaining({
      attempt_id: attemptId,
      status: "failed",
      estimated_micro_usd: 40_000,
      latency_ms: 25
    })]);
    expect(settled.costMicroUsd).toBe(40_000);
    expect(toRunStatusResponse(settled).cost_accounting_status).toBe("estimated_complete");
  });

  it("survives a hard kill after dispatch as estimated_pending and blocks replay", async () => {
    const startedAt = new Date("2026-09-03T18:00:00.000Z");
    const config = getConfig({
      NODE_ENV: "test",
      OPENAI_API_KEY: "test-key",
      MAX_RUN_COST_MICRO_USD: "2000000",
      DAILY_COST_CAP_MICRO_USD: "3000000",
      SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough"
    });
    const store = new InMemoryRunStore();
    const budget = new InMemoryBudgetGuard(config);
    const created = (await store.create({
      ownerId: "guest:openai-kill",
      quotaKey: "ip:openai-kill",
      input: { documents: [{
        role: "base",
        source: { type: "url", url: "https://canadabuys.canada.ca/source.pdf" }
      }] },
      idempotencyKey: null,
      reservedMicroUsd: config.MAX_RUN_COST_MICRO_USD,
      now: startedAt
    })).record;
    await budget.reserve({
      runId: created.id,
      quotaKey: created.quotaKey,
      principalKind: "guest",
      amountMicroUsd: created.reservedMicroUsd,
      now: startedAt
    });
    const claimed = await store.claimProcessing(created.id, startedAt);
    expect(claimed).not.toBeNull();
    const claim = { leaseId: claimed!.leaseId, fence: claimed!.fence };
    let parseCalls = 0;
    const client = {
      beta: { responses: { inputTokens: { count: async () => ({
        input_tokens: 100,
        object: "response.input_tokens" as const
      }) } } },
      responses: { parse: async () => {
        parseCalls += 1;
        return {
          id: "paid-response-before-hard-kill",
          output_parsed: emptyDraft(),
          usage: { input_tokens: 100, output_tokens: 50 }
        };
      } }
    } as unknown as OpenAI;
    const adapter = new OpenAIResponsesAdapter(config, client);

    const failure = await adapter.extract([{
      document_sha256: "a".repeat(64),
      document_name: "source.pdf",
      role: "base",
      amendment_number: null,
      parsed_markdown: "The supplier must satisfy the requirement.",
      evidence_chunks: []
    }], {
      beforePaidBatchDispatch: async (plan) => {
        const attemptId = openAiBatchAttemptId(created.id, plan.batchIndex);
        await markPaidCostAttemptStarted({
          store,
          runId: created.id,
          event: {
            attempt_id: attemptId,
            provider: "openai",
            operation: "responses.parse.structured_extraction",
            status: "pending",
            actual_micro_usd: null,
            estimated_micro_usd: plan.maximumEstimatedCostMicroUsd,
            latency_ms: 0,
            retry_of: null,
            cost_provenance: null
          },
          remainingCommitmentMicroUsd: plan.remainingMaximumEstimatedCostMicroUsd,
          maximumRunCostMicroUsd: config.MAX_RUN_COST_MICRO_USD,
          claim,
          now: startedAt
        });
      },
      settlePaidBatch: async () => {
        // A process death has no finally block. Throwing at this exact boundary
        // deterministically reproduces the durable state a replacement worker
        // will load after the paid response but before settlement.
        throw new Error("simulated hard kill before cost settlement");
      }
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: "ModelBatchError", attemptedBatches: 1 });
    expect(parseCalls).toBe(1);
    const reloaded = (await store.get(created.id))!;
    expect(reloaded.reservedMicroUsd).toBe(config.MAX_RUN_COST_MICRO_USD);
    expect(toRunStatusResponse(reloaded).cost_accounting_status).toBe("estimated_pending");
    expect(reloaded.costs).toEqual([expect.objectContaining({
      attempt_id: openAiBatchAttemptId(created.id, 0),
      provider: "openai",
      status: "pending",
      actual_micro_usd: null,
      estimated_micro_usd: expect.any(Number)
    })]);
    expect(await store.claimProcessing(
      created.id,
      new Date(startedAt.getTime() + PROCESSING_LEASE_MS + 1)
    )).toBeNull();
    await expect(budget.reserve({
      runId: crypto.randomUUID(),
      quotaKey: "ip:another-run",
      principalKind: "guest",
      amountMicroUsd: config.MAX_RUN_COST_MICRO_USD,
      now: startedAt
    })).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  });
});
