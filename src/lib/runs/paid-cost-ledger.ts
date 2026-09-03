import type { CostEvent } from "@/contracts";
import { sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import type { RunStore } from "@/lib/runs/store";

interface ProcessingClaim {
  leaseId: string;
  fence: number;
}

function eventCommitment(event: CostEvent): number {
  return event.actual_micro_usd ?? event.estimated_micro_usd ?? 0;
}

function validateMicroUsd(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError("BUDGET_EXCEEDED", `${label} is invalid.`, {
      httpStatus: 503,
      retryable: false
    });
  }
}

export function assertDurableCommitmentFits(input: {
  costMicroUsd: number;
  remainingCommitmentMicroUsd: number;
  reservedMicroUsd: number;
  maximumRunCostMicroUsd: number;
}) {
  validateMicroUsd(input.costMicroUsd, "The recorded provider cost");
  validateMicroUsd(input.remainingCommitmentMicroUsd, "The remaining provider commitment");
  validateMicroUsd(input.reservedMicroUsd, "The run reservation");
  validateMicroUsd(input.maximumRunCostMicroUsd, "The maximum run cost");
  if (
    input.reservedMicroUsd > input.maximumRunCostMicroUsd ||
    input.costMicroUsd + input.remainingCommitmentMicroUsd > input.reservedMicroUsd
  ) {
    throw new AppError(
      "BUDGET_EXCEEDED",
      "The paid provider plan exceeds the durable run reservation.",
      { httpStatus: 503, retryable: false }
    );
  }
}

/** Stable RFC-4122-shaped identity used to make a batch replay detectable. */
export function openAiBatchAttemptId(runId: string, batchIndex: number): string {
  if (!Number.isSafeInteger(batchIndex) || batchIndex < 0) {
    throw new AppError("ANALYSIS_INCOMPLETE", "The OpenAI batch index is invalid.", {
      retryable: false
    });
  }
  const digest = sha256Hex(`rfp-xray:openai-extraction:${runId}:${batchIndex}`);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}`,
    digest.slice(20, 32)
  ].join("-");
}

export async function markPaidCostAttemptStarted(input: {
  store: RunStore;
  runId: string;
  event: CostEvent & { attempt_id: string; status: "pending" };
  remainingCommitmentMicroUsd: number;
  maximumRunCostMicroUsd: number;
  claim: ProcessingClaim;
  now: Date;
}) {
  validateMicroUsd(input.event.estimated_micro_usd ?? -1, "The paid attempt reserve");
  validateMicroUsd(input.remainingCommitmentMicroUsd, "The remaining provider commitment");
  return input.store.update(input.runId, (record) => {
    if (record.costs.some((event) => event.attempt_id === input.event.attempt_id)) {
      throw new AppError(
        "ANALYSIS_INCOMPLETE",
        "The paid provider attempt was already recorded; replay was blocked.",
        { httpStatus: 409, retryable: false }
      );
    }
    const costs = [...record.costs, input.event];
    const costMicroUsd = costs.reduce((total, event) => total + eventCommitment(event), 0);
    assertDurableCommitmentFits({
      costMicroUsd,
      remainingCommitmentMicroUsd: input.remainingCommitmentMicroUsd,
      reservedMicroUsd: record.reservedMicroUsd,
      maximumRunCostMicroUsd: input.maximumRunCostMicroUsd
    });
    return {
      ...record,
      paidProviderAttemptStartedAt: record.paidProviderAttemptStartedAt ?? input.now.toISOString(),
      costs,
      costMicroUsd,
      updatedAt: input.now.toISOString()
    };
  }, input.claim);
}

export async function settlePaidCostAttempt(input: {
  store: RunStore;
  runId: string;
  event: CostEvent & { attempt_id: string; status: "succeeded" | "failed" };
  remainingCommitmentMicroUsd: number;
  maximumRunCostMicroUsd: number;
  claim: ProcessingClaim;
  now: Date;
}) {
  const updated = await input.store.update(input.runId, (record) => {
    const pending = record.costs.find((event) => event.attempt_id === input.event.attempt_id);
    if (!pending || pending.status !== "pending") {
      throw new AppError(
        "ANALYSIS_INCOMPLETE",
        "The paid provider outcome cannot settle an absent or completed attempt.",
        { httpStatus: 409, retryable: false }
      );
    }
    const costs = record.costs.map((event) =>
      event.attempt_id === input.event.attempt_id ? input.event : event
    );
    return {
      ...record,
      costs,
      costMicroUsd: costs.reduce((total, event) => total + eventCommitment(event), 0),
      updatedAt: input.now.toISOString()
    };
  }, input.claim);
  // The paid request has already happened, so persist the truthful settlement
  // first. If it consumed a future commitment, fail closed before another
  // provider request can start.
  assertDurableCommitmentFits({
    costMicroUsd: updated.costMicroUsd,
    remainingCommitmentMicroUsd: input.remainingCommitmentMicroUsd,
    reservedMicroUsd: updated.reservedMicroUsd,
    maximumRunCostMicroUsd: input.maximumRunCostMicroUsd
  });
  return updated;
}
