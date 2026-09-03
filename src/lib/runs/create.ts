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
const ADMISSION_LEASE_MS = 2 * 60_000;

interface AdmissionDependencies {
  config: AppConfig;
  store: RunStore;
  budget: BudgetGuard;
  uploadStorage: UploadStorage;
  schedule: (runId: string) => Promise<string | null>;
}

interface AdmissionClaim {
  admissionLeaseId: string;
}

class AdmissionAttemptError extends Error {
  constructor(
    readonly attemptError: unknown,
    readonly record: RunRecord,
    readonly claim: AdmissionClaim,
    readonly phase: "preflight" | "schedule_uncertain"
  ) {
    super("Run admission failed while holding the single-writer lease.");
  }
}

function principalKindFor(record: RunRecord): Principal["kind"] {
  return record.ownerId.startsWith("api:") ? "api" : "guest";
}

async function admitQueuedRun(
  record: RunRecord,
  dependencies: AdmissionDependencies,
  options: { now?: Date; rescheduleBefore?: Date } = {}
): Promise<RunRecord> {
  if (record.status !== "queued") return record;
  if (!record.input) {
    throw new AppError("ANALYSIS_INCOMPLETE", "The queued run no longer contains its source manifest.", {
      httpStatus: 409
    });
  }
  const acquired = await dependencies.store.claimAdmission(
    record.id,
    options.now ?? new Date(),
    ADMISSION_LEASE_MS,
    options.rescheduleBefore
  );
  if (!acquired) return (await dependencies.store.get(record.id)) ?? record;
  const claim: AdmissionClaim = { admissionLeaseId: acquired.admissionLeaseId };
  const claimedRecord = acquired.record;
  let schedulingStarted = false;
  try {
    for (const document of claimedRecord.input!.documents) {
      if (document.source.type !== "upload") continue;
      await dependencies.uploadStorage.claimIncoming({
        ownerId: claimedRecord.ownerId,
        runId: claimedRecord.id,
        blobPath: document.source.blob_path,
        expectedSha256: document.source.sha256,
        expectedSize: document.source.size_bytes
      });
    }
    await dependencies.budget.reserve({
      runId: claimedRecord.id,
      quotaKey: claimedRecord.quotaKey,
      principalKind: principalKindFor(claimedRecord),
      amountMicroUsd: claimedRecord.reservedMicroUsd
    });
    // Once scheduler delivery begins, an exception is not proof that enqueue
    // failed. Keep the durable queued record and lease for maintenance retry;
    // the processing CAS ensures delayed/duplicate workflows cannot both run
    // the paid pipeline.
    schedulingStarted = true;
    const workflowRunId = await dependencies.schedule(claimedRecord.id);
    return dependencies.store.update(claimedRecord.id, (current) => ({
      ...current,
      workflowRunId: workflowRunId ?? current.workflowRunId,
      admissionLeaseId: null,
      admissionLeaseExpiresAt: null,
      updatedAt: new Date().toISOString()
    }), claim);
  } catch (error) {
    throw new AdmissionAttemptError(
      error,
      claimedRecord,
      claim,
      schedulingStarted ? "schedule_uncertain" : "preflight"
    );
  }
}

async function failAdmission(
  record: RunRecord,
  error: unknown,
  dependencies: Omit<AdmissionDependencies, "schedule">,
  removeAfterCleanup: boolean,
  claim: AdmissionClaim
): Promise<{ record: RunRecord; failureApplied: boolean }> {
  const failure = asAppError(error);
  let failed: RunRecord;
  try {
    failed = await dependencies.store.update(record.id, (current) => current.status === "queued"
      ? {
          ...transitionRun(current, "failed"),
          admissionLeaseId: null,
          admissionLeaseExpiresAt: null,
          result: null,
          error: {
            code: failure.code,
            message: failure.message,
            retryable: failure.retryable,
            request_id: failure.requestId
          }
        }
      : {
          ...current,
          admissionLeaseId: null,
          admissionLeaseExpiresAt: null
        }, claim);
  } catch {
    const current = await dependencies.store.get(record.id);
    return { record: current ?? record, failureApplied: false };
  }
  const failureApplied = failed.status === "failed" && failed.error?.request_id === failure.requestId;
  if (!failureApplied) return { record: failed, failureApplied: false };
  failed = await cleanupRun(failed, dependencies.store, dependencies.uploadStorage, "failed");
  await dependencies.budget.settle(failed.id, 0);
  if (failed.status === "cleanup_pending") await scheduleCleanupRetry(failed.id);
  // An idempotent peer may already have received this durable run id. Keep
  // that row as a truthful failed response instead of turning it into a 404.
  if (removeAfterCleanup && !failed.idempotencyKey && failed.status !== "cleanup_pending") {
    await dependencies.store.remove(failed.id);
  }
  return { record: failed, failureApplied: true };
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
  const deferredRunIds: string[] = [];
  for (const candidate of candidates) {
    if (new Date(candidate.expiresAt) <= now) continue;
    try {
      const recovered = await admitQueuedRun(candidate, {
        config, store, budget, uploadStorage, schedule
      }, {
        now,
        rescheduleBefore: new Date(now.getTime() - ADMISSION_RECOVERY_DELAY_MS)
      });
      if (recovered.workflowRunId !== null) recoveredRunIds.push(recovered.id);
    } catch (error) {
      const attempt = error instanceof AdmissionAttemptError ? error : null;
      if (attempt?.phase === "schedule_uncertain") {
        deferredRunIds.push(candidate.id);
        continue;
      }
      try {
        if (attempt) {
          await failAdmission(
            attempt.record,
            attempt.attemptError,
            { config, store, budget, uploadStorage },
            false,
            attempt.claim
          );
        }
      } finally {
        failedRunIds.push(candidate.id);
      }
    }
  }
  return { recoveredRunIds, failedRunIds, deferredRunIds };
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
      if (!(error instanceof AdmissionAttemptError)) throw error;
      if (error.phase === "schedule_uncertain") {
        created.record = (await store.get(error.record.id)) ?? error.record;
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
      const failure = asAppError(error.attemptError);
      const admissionFailure = await failAdmission(
        error.record,
        failure,
        { config, store, budget, uploadStorage },
        true,
        error.claim
      );
      created.record = admissionFailure.record;
      if (!admissionFailure.failureApplied) {
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
