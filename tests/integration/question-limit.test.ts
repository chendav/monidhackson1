import { afterEach, describe, expect, it } from "vitest";
import { POST as postQuestion } from "@/app/api/v1/runs/[runId]/questions/route";
import { createEdmontonSampleResult } from "@/lib/fixtures/edmonton";
import {
  InMemoryQuestionAuditStore,
  resetQuestionAuditStoreForTests,
  setQuestionAuditStoreForTests
} from "@/lib/questions/audit-store";
import {
  InMemoryRunStore,
  resetInMemoryRunStoreForTests,
  setRunStoreForTests
} from "@/lib/runs/store";
import { authenticateRequest } from "@/lib/security/auth";

afterEach(() => {
  resetInMemoryRunStoreForTests();
  resetQuestionAuditStoreForTests();
});

describe("closed-world question quota", () => {
  it("answers ten questions and rate-limits the eleventh request", async () => {
    const session = authenticateRequest(new Request("http://localhost/session"));
    const cookie = session.setCookie?.split(";", 1)[0];
    expect(cookie).toBeTruthy();

    const store = new InMemoryRunStore();
    const auditStore = new InMemoryQuestionAuditStore();
    setRunStoreForTests(store);
    setQuestionAuditStoreForTests(auditStore);
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
    await store.update(created.record.id, (record) => ({
      ...record,
      status: "partial",
      stage: "partial",
      progress: 100,
      cleanupConfirmed: true,
      result: createEdmontonSampleResult()
    }));

    const send = () => postQuestion(new Request(
      `http://localhost/api/v1/runs/${created.record.id}/questions`,
      {
        method: "POST",
        headers: { cookie: cookie!, "content-type": "application/json" },
        body: JSON.stringify({ question: "What is the lowest evaluated price selection method?" })
      }
    ), { params: Promise.resolve({ runId: created.record.id }) });

    for (let index = 0; index < 10; index += 1) {
      const response = await send();
      expect(response.status).toBe(200);
    }
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    await expect(limited.json()).resolves.toMatchObject({ error: { code: "RATE_LIMITED" } });
  });
});
