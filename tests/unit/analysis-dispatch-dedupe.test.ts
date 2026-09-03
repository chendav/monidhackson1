import { describe, expect, it, vi } from "vitest";
import { getConfig } from "@/lib/config";
import { createRun, recoverUnscheduledRuns } from "@/lib/runs/create";
import {
  ANALYSIS_DISPATCH_RECOVERY_GRACE_MS,
  InMemoryRunStore
} from "@/lib/runs/store";
import { InMemoryBudgetGuard } from "@/lib/security/budget";
import type { UploadStorage } from "@/lib/storage/uploads";
import type { AnalysisDispatchStatus, RunRecord } from "@/lib/runs/types";

const config = getConfig({
  NODE_ENV: "test",
  SESSION_SIGNING_SECRET: "analysis-dispatch-test-session-secret",
  IP_HASH_SECRET: "analysis-dispatch-test-ip-secret",
  MAX_RUN_COST_MICRO_USD: "2000000",
  DAILY_COST_CAP_MICRO_USD: "20000000"
});

const input = {
  documents: [{
    role: "base" as const,
    source: {
      type: "url" as const,
      url: "https://canadabuys.canada.ca/analysis-dispatch-test.pdf"
    }
  }]
};

function cleanupStorage() {
  return {
    remove: vi.fn(async () => undefined),
    sweepExpiredIncoming: vi.fn(async () => [])
  } as unknown as UploadStorage;
}

class AnalysisClaimAckLossStore extends InMemoryRunStore {
  private loseFirstAck = true;

  override async claimAnalysisDispatch(
    id: string,
    admissionLeaseId: string,
    now?: Date
  ) {
    const claimed = await super.claimAnalysisDispatch(id, admissionLeaseId, now);
    if (claimed && this.loseFirstAck) {
      this.loseFirstAck = false;
      throw new Error("database response lost after analysis dispatch claim commit");
    }
    return claimed;
  }
}

class AnalysisSettlementAckLossStore extends InMemoryRunStore {
  private loseFirstAck = true;

  override async settleAnalysisDispatch(
    id: string,
    analysisDispatchClaimId: string,
    outcome: {
      status: Exclude<AnalysisDispatchStatus, "dispatching">;
      workflowRunId: string | null;
      uncertainAt: Date | null;
    },
    now?: Date
  ): Promise<RunRecord | null> {
    const settled = await super.settleAnalysisDispatch(
      id,
      analysisDispatchClaimId,
      outcome,
      now
    );
    if (settled && this.loseFirstAck) {
      this.loseFirstAck = false;
      throw new Error("database response lost after dispatch settlement commit");
    }
    return settled;
  }
}

describe("per-run analysis Workflow dispatch fence", () => {
  it("allows only one permanent claim under concurrent contenders", async () => {
    const store = new InMemoryRunStore();
    const created = await store.create({
      ownerId: "guest:claim-race",
      quotaKey: "ip:claim-race",
      input,
      idempotencyKey: "claim-race",
      reservedMicroUsd: config.MAX_RUN_COST_MICRO_USD
    });
    const admission = await store.claimAdmission(created.record.id);
    expect(admission).not.toBeNull();

    const claims = await Promise.all(Array.from({ length: 16 }, () =>
      store.claimAnalysisDispatch(created.record.id, admission!.admissionLeaseId)
    ));

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await store.get(created.record.id)).toMatchObject({
      status: "queued",
      analysisDispatchStatus: "dispatching",
      workflowRunId: null
    });
    expect((await store.get(created.record.id))?.analysisDispatchClaimId).not.toBeNull();
  });

  it("never calls start after the dispatch-claim DB commit ACK is lost", async () => {
    const store = new AnalysisClaimAckLossStore();
    const budget = new InMemoryBudgetGuard(config);
    const settle = vi.spyOn(budget, "settle");
    const schedule = vi.fn(async () => "must-not-start");
    const principal = {
      id: "guest:claim-ack-loss",
      quotaKey: "ip:claim-ack-loss",
      kind: "guest" as const
    };

    const created = await createRun(input, principal, "claim-ack-loss", {
      config,
      store,
      budget,
      schedule
    });
    expect(schedule).not.toHaveBeenCalled();
    expect(created.record).toMatchObject({
      status: "queued",
      analysisDispatchStatus: "dispatching",
      workflowRunId: null
    });

    const replay = await createRun(input, principal, "claim-ack-loss", {
      config,
      store,
      budget,
      schedule
    });
    expect(replay.created).toBe(false);
    expect(schedule).not.toHaveBeenCalled();

    const claimedAt = new Date(replay.record.analysisDispatchClaimedAt!);
    const recovered = await recoverUnscheduledRuns({
      config,
      store,
      budget,
      uploadStorage: cleanupStorage(),
      schedule,
      now: new Date(claimedAt.getTime() + ANALYSIS_DISPATCH_RECOVERY_GRACE_MS)
    });
    expect(recovered).toEqual({
      recoveredRunIds: [],
      failedRunIds: [replay.record.id],
      deferredRunIds: []
    });
    expect(schedule).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(await store.get(replay.record.id)).toMatchObject({
      status: "failed",
      cleanupConfirmed: true,
      analysisDispatchStatus: "dispatching",
      error: { code: "ANALYSIS_INCOMPLETE", retryable: false }
    });
  });

  it("retains the claim and reservation when start ACK is lost", async () => {
    const store = new InMemoryRunStore();
    const budget = new InMemoryBudgetGuard(config);
    const settle = vi.spyOn(budget, "settle");
    const schedule = vi.fn(async () => {
      throw new Error("Workflow start acknowledgement lost");
    });
    const principal = {
      id: "guest:start-ack-loss",
      quotaKey: "ip:start-ack-loss",
      kind: "guest" as const
    };

    const created = await createRun(input, principal, "start-ack-loss", {
      config,
      store,
      budget,
      schedule
    });
    expect(schedule).toHaveBeenCalledOnce();
    expect(created.record).toMatchObject({
      status: "queued",
      analysisDispatchStatus: "dispatch_uncertain",
      workflowRunId: null
    });
    expect(created.record.analysisDispatchClaimId).not.toBeNull();

    await createRun(input, principal, "start-ack-loss", {
      config,
      store,
      budget,
      schedule
    });
    expect(schedule).toHaveBeenCalledOnce();

    const uncertainAt = new Date(created.record.analysisDispatchUncertainAt!);
    const recovered = await recoverUnscheduledRuns({
      config,
      store,
      budget,
      uploadStorage: cleanupStorage(),
      schedule,
      now: new Date(uncertainAt.getTime() + ANALYSIS_DISPATCH_RECOVERY_GRACE_MS)
    });
    expect(recovered.failedRunIds).toEqual([created.record.id]);
    expect(schedule).toHaveBeenCalledOnce();
    expect(settle).not.toHaveBeenCalled();
    expect(await store.get(created.record.id)).toMatchObject({
      status: "failed",
      cleanupConfirmed: true,
      analysisDispatchStatus: "dispatch_uncertain",
      error: { code: "ANALYSIS_INCOMPLETE", retryable: false }
    });
    expect(await store.claimProcessing(created.record.id)).toBeNull();
  });

  it("does not redispatch when start succeeds and the committed settlement ACK is lost", async () => {
    const store = new AnalysisSettlementAckLossStore();
    const budget = new InMemoryBudgetGuard(config);
    const schedule = vi.fn(async () => "workflow-accepted-once");
    const principal = {
      id: "guest:settlement-ack-loss",
      quotaKey: "ip:settlement-ack-loss",
      kind: "guest" as const
    };

    const created = await createRun(input, principal, "settlement-ack-loss", {
      config,
      store,
      budget,
      schedule
    });
    expect(created.record).toMatchObject({
      status: "queued",
      workflowRunId: "workflow-accepted-once",
      analysisDispatchStatus: "scheduled"
    });
    expect(schedule).toHaveBeenCalledOnce();

    await createRun(input, principal, "settlement-ack-loss", {
      config,
      store,
      budget,
      schedule
    });
    expect(schedule).toHaveBeenCalledOnce();

    // If the delayed accepted Workflow wins the queued-state CAS, maintenance
    // observes a non-queued run and cannot terminally clean it. The inverse
    // ordering is covered above: maintenance wins, then claimProcessing is
    // null. In either ordering only one side can own processing.
    const claimedAt = new Date(created.record.analysisDispatchClaimedAt!);
    const [processing, recovered] = await Promise.all([
      store.claimProcessing(created.record.id, new Date(claimedAt.getTime() + 1)),
      recoverUnscheduledRuns({
        config,
        store,
        budget,
        uploadStorage: cleanupStorage(),
        schedule,
        now: new Date(claimedAt.getTime() + ANALYSIS_DISPATCH_RECOVERY_GRACE_MS)
      })
    ]);
    expect(processing).not.toBeNull();
    expect(recovered).toEqual({
      recoveredRunIds: [],
      failedRunIds: [],
      deferredRunIds: []
    });
    expect(schedule).toHaveBeenCalledOnce();
    expect((await store.get(created.record.id))?.status).toBe("validating");
  });
});
