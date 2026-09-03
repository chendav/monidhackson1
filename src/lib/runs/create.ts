import { CreateRunResponseSchema, type CreateRunRequest } from "@/contracts";
import { getConfig, getProductionReadiness, type AppConfig } from "@/lib/config";
import { asAppError, AppError } from "@/lib/errors";
import { transitionRun } from "@/lib/runs/state-machine";
import { getRunStore, type RunStore } from "@/lib/runs/store";
import { scheduleCleanupRetry, scheduleRun } from "@/lib/runs/scheduler";
import { cleanupRun } from "@/lib/runs/expiry";
import type { RunRecord } from "@/lib/runs/types";
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

const ADMISSION_RECOVERY_DELAY_MS = 60_000;
const ADMISSION_RECOVERY_BATCH_SIZE = 20;

interface AdmissionDependencies {
  config: AppConfig;
  store: RunStore;
  budget: BudgetGuard;
  uploadStorage: UploadStorage;
  schedule: (runId: string) => Promise<string | null>;
}

function principalKindFor(record: RunRecord): Principal["kind"] {
  return record.ownerId.startsWith("api:") ? "api" : "guest";
}

async function admitQueuedRun(
  record: RunRecord,
  dependencies: AdmissionDependencies
): Promise<RunRecord> {
  if (record.status !== "queued" || record.workflowRunId !== null) return record;
  if (!record.input) {
    throw new AppError("ANALYSIS_INCOMPLETE", "The queued run no longer contains its source manifest.", {
      httpStatus: 409
    });
  }
  for (const document of record.input.documents) {
    if (document.source.type !== "upload") continue;
    await dependencies.uploadStorage.claimIncoming({
      ownerId: record.ownerId,
      runId: record.id,
      blobPath: document.source.blob_path,
      expectedSha256: document.source.sha256,
      expectedSize: document.source.size_bytes
    });
  }
  await dependencies.budget.reserve({
    runId: record.id,
    quotaKey: record.quotaKey,
    principalKind: principalKindFor(record),
    amountMicroUsd: record.reservedMicroUsd
  });
  const workflowRunId = await dependencies.schedule(record.id);
  if (!workflowRunId) return (await dependencies.store.get(record.id)) ?? record;
  return dependencies.store.update(record.id, (current) => current.workflowRunId
    ? current
    : {
        ...current,
        workflowRunId,
        updatedAt: new Date().toISOString()
      });
}

async function failAdmission(
  record: RunRecord,
  error: unknown,
  dependencies: Omit<AdmissionDependencies, "schedule">,
  removeAfterCleanup: boolean
): Promise<RunRecord> {
  const failure = asAppError(error);
  let failed = await dependencies.store.update(record.id, (current) => ({
    ...transitionRun(current, "failed"),
    result: null,
    error: {
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
      request_id: failure.requestId
    }
  }));
  failed = await cleanupRun(failed, dependencies.store, dependencies.uploadStorage, "failed");
  await dependencies.budget.settle(failed.id, 0);
  if (failed.status === "cleanup_pending") await scheduleCleanupRetry(failed.id);
  if (removeAfterCleanup && failed.status !== "cleanup_pending") {
    await dependencies.store.remove(failed.id);
  }
  return failed;
}

export interface AdmissionRecoveryDependencies {
  config?: AppConfig;
  store?: RunStore;
  budget?: BudgetGuard;
  uploadStorage?: UploadStorage;
  schedule?: (runId: string) => Promise<string | null>;
  now?: Date;
}

export async function recoverUnscheduledRuns(
  dependencies: AdmissionRecoveryDependencies = {}
) {
  const config = dependencies.config ?? getConfig();
  const store = dependencies.store ?? await getRunStore();
  const budget = dependencies.budget ?? getBudgetGuard(config);
  const uploadStorage = dependencies.uploadStorage ?? getUploadStorage(config);
  const schedule = dependencies.schedule ?? scheduleRun;
  const now = dependencies.now ?? new Date();
  const candidates = await store.listUnscheduledQueued(
    new Date(now.getTime() - ADMISSION_RECOVERY_DELAY_MS),
    ADMISSION_RECOVERY_BATCH_SIZE
  );
  const recoveredRunIds: string[] = [];
  const failedRunIds: string[] = [];
  for (const candidate of candidates) {
    if (new Date(candidate.expiresAt) <= now) continue;
    try {
      const recovered = await admitQueuedRun(candidate, {
        config, store, budget, uploadStorage, schedule
      });
      if (recovered.workflowRunId !== null) recoveredRunIds.push(recovered.id);
    } catch (error) {
      try {
        await failAdmission(candidate, error, { config, store, budget, uploadStorage }, false);
      } finally {
        failedRunIds.push(candidate.id);
      }
    }
  }
  return { recoveredRunIds, failedRunIds };
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
  if (created.created || (created.record.status === "queued" && created.record.workflowRunId === null)) {
    const budget = dependencies.budget ?? getBudgetGuard(config);
    const uploadStorage = dependencies.uploadStorage ?? getUploadStorage(config);
    try {
      created.record = await admitQueuedRun(created.record, {
        config,
        store,
        budget,
        uploadStorage,
        schedule: dependencies.schedule ?? scheduleRun
      });
    } catch (error) {
      const failure = asAppError(error);
      created.record = await failAdmission(
        created.record,
        failure,
        { config, store, budget, uploadStorage },
        true
      );
      if (created.record.status === "cleanup_pending") {
        throw new AppError(
          "SOURCE_CLEANUP_PENDING",
          "The run was not accepted and input cleanup is still being retried.",
          { httpStatus: 503, retryable: true }
        );
      }
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
