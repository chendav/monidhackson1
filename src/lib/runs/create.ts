import { CreateRunResponseSchema, type CreateRunRequest } from "@/contracts";
import { getConfig, getProductionReadiness, type AppConfig } from "@/lib/config";
import { asAppError, AppError } from "@/lib/errors";
import { transitionRun } from "@/lib/runs/state-machine";
import { getRunStore, type RunStore } from "@/lib/runs/store";
import { scheduleCleanupRetry, scheduleRun } from "@/lib/runs/scheduler";
import { cleanupRun } from "@/lib/runs/expiry";
import type { Principal } from "@/lib/security/auth";
import { uploadNamespaceSecret } from "@/lib/security/auth";
import { getBudgetGuard, type BudgetGuard } from "@/lib/security/budget";
import { validateCreateRunRequest } from "@/lib/source-validation";
import { getUploadStorage, type UploadStorage } from "@/lib/storage/uploads";

export interface CreateRunDependencies {
  config?: AppConfig;
  store?: RunStore;
  budget?: BudgetGuard;
  uploadStorage?: UploadStorage;
  schedule?: (runId: string) => Promise<string | null>;
}

export async function createRun(
  rawInput: unknown,
  principal: Principal,
  idempotencyKey: string | null,
  dependencies: CreateRunDependencies = {}
) {
  const config = dependencies.config ?? getConfig();
  if (!getProductionReadiness(config).ready) {
    throw new AppError("ANALYSIS_INCOMPLETE", "The production analysis service is not fully configured.", {
      httpStatus: 503,
      retryable: true
    });
  }
  const store = dependencies.store ?? await getRunStore();
  const input: CreateRunRequest = validateCreateRunRequest(rawInput, {
    ownerId: principal.id,
    uploadSecret: uploadNamespaceSecret(config)
  });
  const reservedMicroUsd =
    config.MONID_PARSE_RESERVE_MICRO_USD * input.documents.length +
    config.OPENAI_RUN_RESERVE_MICRO_USD;
  const runId = crypto.randomUUID();
  const created = await store.create({
    id: runId,
    ownerId: principal.id,
    quotaKey: principal.quotaKey,
    input,
    idempotencyKey,
    reservedMicroUsd
  });
  if (created.created) {
    const budget = dependencies.budget ?? getBudgetGuard(config);
    const uploadStorage = dependencies.uploadStorage ?? getUploadStorage(config);
    try {
      for (const document of input.documents) {
        if (document.source.type !== "upload") continue;
        await uploadStorage.claimIncoming({
          ownerId: principal.id,
          runId: created.record.id,
          blobPath: document.source.blob_path,
          expectedSha256: document.source.sha256,
          expectedSize: document.source.size_bytes
        });
      }
      await budget.reserve({
        runId: created.record.id,
        quotaKey: principal.quotaKey,
        principalKind: principal.kind,
        amountMicroUsd: reservedMicroUsd
      });
      const workflowRunId = await (dependencies.schedule ?? scheduleRun)(created.record.id);
      if (workflowRunId) {
        created.record.workflowRunId = workflowRunId;
      }
    } catch (error) {
      const failure = asAppError(error);
      created.record = await store.update(created.record.id, (record) => ({
        ...transitionRun(record, "failed"),
        result: null,
        error: {
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
          request_id: failure.requestId
        }
      }));
      created.record = await cleanupRun(created.record, store, uploadStorage, "failed");
      await budget.settle(created.record.id, 0);
      if (created.record.status === "cleanup_pending") {
        await scheduleCleanupRetry(created.record.id);
        throw new AppError(
          "SOURCE_CLEANUP_PENDING",
          "The run was not accepted and input cleanup is still being retried.",
          { httpStatus: 503, retryable: true }
        );
      }
      await store.remove(created.record.id);
      throw failure;
    }
  }
  return {
    record: created.record,
    response: CreateRunResponseSchema.parse({
      run_id: created.record.id,
      status: created.record.status,
      status_url: `/api/v1/runs/${created.record.id}`
    }),
    created: created.created
  };
}
