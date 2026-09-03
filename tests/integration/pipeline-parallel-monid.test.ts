import { describe, expect, it, vi } from "vitest";
import type { PresignUploadResponse } from "@/contracts";
import { LocalDeterministicModel } from "@/lib/analysis/local-model";
import { getConfig } from "@/lib/config";
import { sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import {
  LIVE_NETWORK_BUDGET_MS,
  MONID_MIN_PAID_CALL_WINDOW_MS,
  MONID_PARSE_CONCURRENCY,
  processRun
} from "@/lib/pipeline";
import {
  MonidTerminalProviderError,
  type MonidAdapter,
  type MonidParseInput,
  type MonidParseResult
} from "@/lib/providers/monid";
import type { AnalysisModel, ModelDocumentInput } from "@/lib/providers/openai";
import { InMemoryRunStore } from "@/lib/runs/store";
import { toRunStatusResponse } from "@/lib/runs/types";
import { runSourceCleanupWatchdog } from "@/lib/runs/source-cleanup-watchdog";
import { InMemoryBudgetGuard } from "@/lib/security/budget";
import type { UploadStorage } from "@/lib/storage/uploads";
import { makeMinimalPdf } from "../unit/minimal-pdf";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${message}.`);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function documentIndexFromPath(value: string) {
  const match = value.match(/\/staging\/[^/]+\/(\d+)\/source\.pdf$/);
  if (!match) throw new Error("The test storage received an unexpected staging path.");
  return Number(match[1]);
}

class ParallelUploadStorage implements UploadStorage {
  readonly stagedRemovals: number[] = [];
  readonly incomingPurgeAttempts: number[] = [];
  private readonly objects = new Map<string, Uint8Array>();

  constructor(readonly incomingPaths: string[], documents: Uint8Array[]) {
    for (const [index, path] of incomingPaths.entries()) {
      this.objects.set(path, documents[index].slice());
    }
  }

  async presign(): Promise<PresignUploadResponse> {
    throw new Error("not used");
  }

  async claimIncoming(): Promise<void> {}

  async read(path: string): Promise<Uint8Array> {
    const bytes = this.objects.get(path);
    if (!bytes) {
      throw new AppError("SOURCE_UNREACHABLE", "not found", { httpStatus: 404 });
    }
    return bytes.slice();
  }

  async stage(path: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(path, bytes.slice());
  }

  async temporaryReadUrl(path: string): Promise<string> {
    return `https://private-blob.example${path.startsWith("/") ? "" : "/"}${path}`;
  }

  async purgeIncomingToFence(path: string): Promise<void> {
    const index = this.incomingPaths.indexOf(path);
    if (index >= 0) this.incomingPurgeAttempts.push(index);
    this.objects.delete(path);
  }

  async remove(path: string): Promise<void> {
    this.stagedRemovals.push(documentIndexFromPath(`/${path}`));
    this.objects.delete(path);
  }

  async sweepExpiredIncoming(): Promise<string[]> {
    return [];
  }
}

const liveConfig = getConfig({
  NODE_ENV: "test",
  SESSION_SIGNING_SECRET: "parallel-monid-test-session-secret-is-long-enough",
  IP_HASH_SECRET: "parallel-monid-ip-secret",
  MONID_API_KEY: "test-monid-key",
  MONID_PARSE_PROVIDER: "context.dev",
  MONID_PARSE_ENDPOINT: "/parse",
  MONID_RUN_ID_PATH: "run.id",
  MONID_RUN_STATUS_PATH: "run.status",
  MONID_PROVIDER_STATUS_PATH: "run.provider_status",
  MONID_RESULT_URL_PATH: "run.result_url",
  MONID_COST_VALUE_PATH: "run.cost.value",
  MONID_COST_CURRENCY_PATH: "run.cost.currency",
  MONID_COST_VALUE_UNIT: "currency_major",
  MONID_INSPECT_SCHEMA_SHA256: "a".repeat(64),
  MONID_ARTIFACT_HOST_ALLOWLIST: "private-blob.example",
  OPENAI_API_KEY: "test-openai-key",
  MAX_RUN_COST_MICRO_USD: "2000000",
  DAILY_COST_CAP_MICRO_USD: "20000000"
});

function monidResult(index: number): MonidParseResult {
  return {
    markdown: `Document ${index} must provide item ${index}.`,
    runId: `monid-run-${index}`,
    costAmount: (index + 1) / 1_000,
    costValueUnit: "currency_major",
    costCurrency: "USD",
    costProvenance: {
      kind: "credentialed_inspect",
      inspect_schema_sha256: "a".repeat(64),
      value_path: "run.cost.value",
      currency_path: "run.cost.currency",
      value_unit: "currency_major",
      source_value: (index + 1) / 1_000,
      source_currency: "USD"
    },
    providerArtifactUrl: `https://private-blob.example/result-${index}.md`,
    providerRetention: "unknown",
    terminalPayload: { documentIndex: index }
  };
}

function fixtureDocuments(count: number) {
  return Array.from({ length: count }, (_, index) => makeMinimalPdf([
    `Solicitation No: TEST-2026${index === 0 ? "" : ` Amendment ${String(index).padStart(3, "0")}`}. ` +
      `Document ${index} must provide item ${index}.`
  ]));
}

async function seededRun(store: InMemoryRunStore, documents: Uint8Array[]) {
  const incomingPaths = documents.map((bytes, index) =>
    `incoming/parallel-test/document-${index}/${sha256Hex(bytes)}.pdf`
  );
  const record = (await store.create({
    ownerId: "guest:parallel-monid",
    quotaKey: "ip:parallel-monid",
    input: {
      documents: documents.map((bytes, index) => ({
        role: index === 0 ? "base" as const : "amendment" as const,
        source: {
          type: "upload" as const,
          blob_path: incomingPaths[index],
          sha256: sha256Hex(bytes),
          size_bytes: bytes.byteLength,
          filename: `document-${index}.pdf`
        }
      }))
    },
    idempotencyKey: null,
    reservedMicroUsd: 2_000_000
  })).record;
  return { record, incomingPaths };
}

describe("bounded parallel Monid parsing", () => {
  it("rejects a misconfigured whole-run commitment before any paid provider dispatch", async () => {
    const documents = fixtureDocuments(1);
    const store = new InMemoryRunStore();
    const { record, incomingPaths } = await seededRun(store, documents);
    await store.update(record.id, (current) => ({
      ...current,
      reservedMicroUsd:
        liveConfig.MONID_PARSE_RESERVE_MICRO_USD +
        liveConfig.OPENAI_RUN_RESERVE_MICRO_USD - 1
    }));
    const storage = new ParallelUploadStorage(incomingPaths, documents);
    let monidPaidDispatches = 0;
    let openAiPaidDispatches = 0;
    const monid = {
      async parse() {
        monidPaidDispatches += 1;
        return monidResult(0);
      }
    } as unknown as MonidAdapter;
    const model = {
      async extract() {
        openAiPaidDispatches += 1;
        return new LocalDeterministicModel().extract([]);
      },
      async answer() {
        throw new Error("not used");
      }
    } as AnalysisModel;

    const result = await processRun(record.id, {
      store,
      uploadStorage: storage,
      budget: new InMemoryBudgetGuard(liveConfig),
      config: liveConfig,
      monid,
      model,
      cleanupWatchdogScheduler: async () => "cleanup-workflow"
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BUDGET_EXCEEDED");
    expect(result.paidProviderAttemptStartedAt).toBeNull();
    expect(result.costs).toEqual([]);
    expect(monidPaidDispatches).toBe(0);
    expect(openAiPaidDispatches).toBe(0);
  });

  it("rechecks the paid-call window after URL work and blocks dispatch without recording a charge", async () => {
    const documents = fixtureDocuments(1);
    const store = new InMemoryRunStore();
    const { record, incomingPaths } = await seededRun(store, documents);
    const storage = new ParallelUploadStorage(incomingPaths, documents);
    let monotonicMs = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => monotonicMs);
    let paidDispatches = 0;
    const monid = {
      async parse(input: MonidParseInput) {
        monotonicMs = LIVE_NETWORK_BUDGET_MS - MONID_MIN_PAID_CALL_WINDOW_MS + 1;
        await input.beforePaidDispatch?.();
        paidDispatches += 1;
        return monidResult(0);
      }
    } as unknown as MonidAdapter;
    try {
      const result = await processRun(record.id, {
        store,
        uploadStorage: storage,
        budget: new InMemoryBudgetGuard(liveConfig),
        config: liveConfig,
        monid,
        cleanupWatchdogScheduler: async () => "cleanup-workflow"
      });
      expect(result.status).toBe("failed");
      expect(result.paidProviderAttemptStartedAt).toBeNull();
      expect(result.costs.filter((event) => event.provider === "monid")).toEqual([]);
      expect(paidDispatches).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  it("withholds READY and trips the budget circuit on observed cost above the full reservation", async () => {
    const documents = fixtureDocuments(1);
    const store = new InMemoryRunStore();
    const { record, incomingPaths } = await seededRun(store, documents);
    const storage = new ParallelUploadStorage(incomingPaths, documents);
    const budget = new InMemoryBudgetGuard(liveConfig);
    await budget.reserve({
      runId: record.id,
      quotaKey: record.quotaKey,
      principalKind: "guest",
      amountMicroUsd: liveConfig.MAX_RUN_COST_MICRO_USD
    });
    const monid = {
      async parse(input: MonidParseInput) {
        await input.beforePaidDispatch?.();
        return {
          ...monidResult(0),
          costAmount: 3,
          costProvenance: {
            ...monidResult(0).costProvenance!,
            source_value: 3
          }
        };
      }
    } as unknown as MonidAdapter;

    await expect(processRun(record.id, {
      store,
      uploadStorage: storage,
      budget,
      config: liveConfig,
      monid,
      model: new LocalDeterministicModel(),
      cleanupWatchdogScheduler: async () => "cleanup-workflow"
    })).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(await store.get(record.id)).toMatchObject({
      status: "failed",
      result: null,
      cleanupConfirmed: true,
      costMicroUsd: 3_495_000
    });
  });

  it("cleans each reverse-order completion immediately but preserves model and cost order", async () => {
    const documents = fixtureDocuments(4);
    const store = new InMemoryRunStore();
    const { record, incomingPaths } = await seededRun(store, documents);
    const storage = new ParallelUploadStorage(incomingPaths, documents);
    const gates = documents.map(() => deferred<void>());
    const started: number[] = [];
    const scheduledWatchdogs: string[] = [];
    const providerSawScheduledWatchdog: boolean[] = [];
    const completed: number[] = [];
    let active = 0;
    let maxActive = 0;

    const monid = {
      async parse(input: MonidParseInput) {
        await input.beforePaidDispatch?.();
        const index = documentIndexFromPath(new URL(input.fileUrl).pathname);
        const snapshot = await store.get(record.id);
        const watchdog = snapshot?.sourceCleanupWatchdogs.find(
          (candidate) => candidate.documentIndex === index
        );
        providerSawScheduledWatchdog[index] = Boolean(
          watchdog?.watchdogScheduledAt && watchdog.providerCallStartedAt
        );
        started.push(index);
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          await gates[index].promise;
          completed.push(index);
          return monidResult(index);
        } finally {
          active -= 1;
        }
      }
    } as unknown as MonidAdapter;

    const local = new LocalDeterministicModel();
    const modelSnapshots: Array<Array<Pick<ModelDocumentInput, "document_name" | "parsed_markdown">>> = [];
    const model: AnalysisModel = {
      async extract(input) {
        modelSnapshots.push(input.map(({ document_name, parsed_markdown }) => ({
          document_name,
          parsed_markdown
        })));
        return local.extract(input);
      },
      answer: local.answer.bind(local)
    };

    const worker = processRun(record.id, {
      store,
      uploadStorage: storage,
      budget: new InMemoryBudgetGuard(liveConfig),
      config: liveConfig,
      monid,
      model,
      cleanupWatchdogScheduler: async (_runId, registrationId) => {
        scheduledWatchdogs.push(registrationId);
        return `cleanup-workflow-${registrationId}`;
      }
    });

    await waitFor(() => started.length === 4, "all four first-batch parses to start");
    expect(started).toEqual([0, 1, 2, 3]);
    expect(scheduledWatchdogs).toHaveLength(4);
    expect(providerSawScheduledWatchdog).toEqual([true, true, true, true]);
    expect(active).toBe(4);
    expect(maxActive).toBe(MONID_PARSE_CONCURRENCY);

    for (const index of [3, 2, 1]) {
      gates[index].resolve();
      await waitFor(
        () => storage.stagedRemovals.includes(index),
        `document ${index} staging cleanup`
      );
      expect(active).toBe(index);
      expect(storage.stagedRemovals).toEqual([3, 2, 1].slice(0, 4 - index));
      expect(modelSnapshots).toHaveLength(0);
    }
    gates[0].resolve();

    const result = await worker;
    expect(completed).toEqual([3, 2, 1, 0]);
    expect(storage.stagedRemovals).toEqual([3, 2, 1, 0]);
    expect(modelSnapshots).toEqual([documents.map((_, index) => ({
      document_name: `document-${index}.pdf`,
      parsed_markdown: `Document ${index} must provide item ${index}.`
    }))]);

    const monidCosts = result.costs.filter((cost) => cost.provider === "monid");
    expect(monidCosts.map((cost) => cost.status)).toEqual([
      "succeeded", "succeeded", "succeeded", "succeeded"
    ]);
    expect(monidCosts.map((cost) => cost.actual_micro_usd)).toEqual([1_000, 2_000, 3_000, 4_000]);
    expect(monidCosts.every((cost) =>
      cost.cost_provenance?.inspect_schema_sha256 === "a".repeat(64) &&
      cost.cost_provenance.value_unit === "currency_major"
    )).toBe(true);
    expect(result.cleanupReceipts.filter((receipt) => receipt.resourceKind === "provider_artifact"))
      .toEqual([0, 1, 2, 3].map((index) => expect.objectContaining({
        resourceId: `provider-artifact:sha256:${sha256Hex(`monid-run-${index}`)}`,
        controlScope: "provider",
        status: "unknown"
      })));
  });

  it("drains an unobserved failed call, protects its live source URL, and cleans it only after expiry", async () => {
    const documents = fixtureDocuments(5);
    const store = new InMemoryRunStore();
    const { record, incomingPaths } = await seededRun(store, documents);
    const storage = new ParallelUploadStorage(incomingPaths, documents);
    const gates = documents.map(() => deferred<void>());
    const started: number[] = [];
    const completed: number[] = [];
    let active = 0;
    let maxActive = 0;

    const monid = {
      async parse(input: MonidParseInput) {
        await input.beforePaidDispatch?.();
        const index = documentIndexFromPath(new URL(input.fileUrl).pathname);
        started.push(index);
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          await gates[index].promise;
          completed.push(index);
          return monidResult(index);
        } finally {
          active -= 1;
        }
      }
    } as unknown as MonidAdapter;

    let modelCalls = 0;
    const local = new LocalDeterministicModel();
    const model: AnalysisModel = {
      async extract(input) {
        modelCalls += 1;
        return local.extract(input);
      },
      answer: local.answer.bind(local)
    };

    let workerSettled = false;
    const worker = processRun(record.id, {
      store,
      uploadStorage: storage,
      budget: new InMemoryBudgetGuard(liveConfig),
      config: liveConfig,
      monid,
      model
    }).finally(() => {
      workerSettled = true;
    });

    await waitFor(() => started.length === 4, "the bounded first parse batch to start");
    expect(active).toBe(4);
    gates[0].reject(new Error("simulated first-batch provider failure"));
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(workerSettled).toBe(false);
    expect(active).toBe(3);
    expect(started).toEqual([0, 1, 2, 3]);
    expect(storage.stagedRemovals).toEqual([]);

    gates[3].resolve();
    gates[2].resolve();
    gates[1].resolve();
    const result = await worker;

    expect(maxActive).toBe(MONID_PARSE_CONCURRENCY);
    expect(started).toEqual([0, 1, 2, 3]);
    expect(completed).toEqual([3, 2, 1]);
    expect(modelCalls).toBe(0);
    expect(result.status).toBe("cleanup_pending");
    expect(result.result).toBeNull();
    expect(new Set(storage.stagedRemovals)).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(storage.incomingPurgeAttempts)).toEqual(new Set([0, 1, 2, 3, 4]));

    const protectedWatchdog = result.sourceCleanupWatchdogs.find(
      (watchdog) => watchdog.documentIndex === 0
    );
    expect(protectedWatchdog).toMatchObject({
      status: "provider_call_started",
      providerResultCapturedAt: null,
      cleanupConfirmedAt: null
    });
    const beforeAccessExpiry = await runSourceCleanupWatchdog({
      store,
      storage,
      runId: record.id,
      registrationId: protectedWatchdog!.registrationId,
      now: new Date(new Date(protectedWatchdog!.sourceAccessExpiresAt!).getTime() - 1)
    });
    expect(beforeAccessExpiry.outcome).toBe("waiting_for_capture");
    expect(storage.stagedRemovals).not.toContain(0);

    const afterAccessExpiry = await runSourceCleanupWatchdog({
      store,
      storage,
      runId: record.id,
      registrationId: protectedWatchdog!.registrationId,
      now: new Date(new Date(protectedWatchdog!.sourceAccessExpiresAt!).getTime() + 1)
    });
    expect(afterAccessExpiry.outcome).toBe("complete");
    expect(new Set(storage.stagedRemovals)).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(await store.get(record.id)).toMatchObject({
      status: "failed",
      cleanupConfirmed: true,
      result: null
    });

    const monidCosts = result.costs.filter((cost) => cost.provider === "monid");
    expect(monidCosts).toHaveLength(4);
    expect(monidCosts.map((cost) => cost.status)).toEqual([
      "pending", "succeeded", "succeeded", "succeeded"
    ]);
    expect(monidCosts.map((cost) => cost.actual_micro_usd)).toEqual([null, 2_000, 3_000, 4_000]);
    expect(result.cleanupReceipts.filter((receipt) => receipt.resourceKind === "provider_artifact"))
      .toEqual([1, 2, 3].map((index) => expect.objectContaining({
        resourceId: `provider-artifact:sha256:${sha256Hex(`monid-run-${index}`)}`,
        controlScope: "provider",
        status: "unknown"
      })));
  });

  it("durably captures a terminal provider failure, hashes its ID, and cleans immediately", async () => {
    const documents = fixtureDocuments(1);
    const store = new InMemoryRunStore();
    const { record, incomingPaths } = await seededRun(store, documents);
    const storage = new ParallelUploadStorage(incomingPaths, documents);
    const providerRunId = "provider-run-id-must-not-be-persisted";
    const monid = {
      async parse(input: MonidParseInput) {
        await input.beforePaidDispatch?.();
        throw new MonidTerminalProviderError(
          "Monid run ended with FAILED.",
          providerRunId,
          "FAILED",
          0.002,
          "USD",
          {
            kind: "credentialed_inspect",
            inspect_schema_sha256: "a".repeat(64),
            value_path: "run.cost.value",
            currency_path: "run.cost.currency",
            value_unit: "currency_major",
            source_value: 0.002,
            source_currency: "USD"
          }
        );
      }
    } as unknown as MonidAdapter;

    const result = await processRun(record.id, {
      store,
      uploadStorage: storage,
      budget: new InMemoryBudgetGuard(liveConfig),
      config: liveConfig,
      monid,
      cleanupWatchdogScheduler: async (_runId, registrationId) =>
        `cleanup-workflow-${registrationId}`
    });

    expect(result.status).toBe("failed");
    expect(result.result).toBeNull();
    expect(storage.stagedRemovals).toContain(0);
    expect(result.sourceCleanupWatchdogs[0]).toMatchObject({
      status: "cleanup_confirmed",
      providerResultIdSha256: sha256Hex(providerRunId)
    });
    expect(result.sourceCleanupWatchdogs[0].providerResultCapturedAt).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain(providerRunId);
    expect(result.costs.find((cost) => cost.provider === "monid")).toMatchObject({
      status: "failed",
      actual_micro_usd: 2_000,
      estimated_micro_usd: null,
      cost_provenance: {
        inspect_schema_sha256: "a".repeat(64),
        value_unit: "currency_major",
        source_value: 0.002,
        source_currency: "USD"
      }
    });
    expect(toRunStatusResponse(result).cost_accounting_status).toBe("actual_complete");
  });
});
