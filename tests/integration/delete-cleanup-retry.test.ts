import { afterEach, describe, expect, it } from "vitest";
import { DELETE as deleteRun } from "@/app/api/v1/runs/[runId]/route";
import {
  InMemoryRunStore,
  resetInMemoryRunStoreForTests,
  setRunStoreForTests
} from "@/lib/runs/store";
import { authenticateRequest } from "@/lib/security/auth";

afterEach(() => {
  resetInMemoryRunStoreForTests();
});

describe("DELETE cleanup retry admission", () => {
  it("reuses one durable retry claim across concurrent and repeated DELETE requests", async () => {
    const session = authenticateRequest(new Request("http://localhost/session"));
    const cookie = session.setCookie?.split(";", 1)[0];
    expect(cookie).toBeTruthy();

    const store = new InMemoryRunStore();
    setRunStoreForTests(store);
    const created = await store.create({
      ownerId: session.id,
      quotaKey: session.quotaKey,
      input: {
        documents: [{
          role: "base",
          source: { type: "url", url: "https://canadabuys.canada.ca/tender.pdf" }
        }]
      },
      idempotencyKey: null,
      reservedMicroUsd: 0
    });
    const processing = await store.claimProcessing(created.record.id, new Date(), 60 * 60_000);
    expect(processing).not.toBeNull();

    const send = () => deleteRun(new Request(
      `http://localhost/api/v1/runs/${created.record.id}`,
      { method: "DELETE", headers: { cookie: cookie! } }
    ), { params: Promise.resolve({ runId: created.record.id }) });

    const firstPair = await Promise.all([send(), send()]);
    expect(firstPair.map((response) => response.status)).toEqual([503, 503]);
    const afterConcurrent = await store.get(created.record.id);
    expect(afterConcurrent).toMatchObject({
      status: "cleanup_pending",
      cleanupRetryDispatchStatus: "not_dispatched"
    });
    expect(afterConcurrent?.cleanupRetryClaimId).not.toBeNull();
    const originalClaimId = afterConcurrent!.cleanupRetryClaimId;
    const originalClaimedAt = afterConcurrent!.cleanupRetryClaimedAt;

    const repeated = await send();
    expect(repeated.status).toBe(503);
    await expect(repeated.json()).resolves.toMatchObject({
      error: { code: "SOURCE_CLEANUP_PENDING", retryable: true }
    });
    expect(await store.get(created.record.id)).toMatchObject({
      cleanupRetryClaimId: originalClaimId,
      cleanupRetryClaimedAt: originalClaimedAt,
      cleanupRetryWorkflowRunId: null,
      cleanupRetryDispatchStatus: "not_dispatched"
    });
  });
});
