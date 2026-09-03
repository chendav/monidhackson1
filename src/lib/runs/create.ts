import { CreateRunResponseSchema, type CreateRunRequest } from "@/contracts";
import { getConfig, getProductionReadiness, type AppConfig } from "@/lib/config";
import { asAppError, AppError } from "@/lib/errors";
import {
  assertWorkflowRuntimeAttested,
  type WorkflowRuntimeAttestationHealth
} from "@/lib/health/workflow-runtime";
import {
  assertProviderContractsActivelyVerified,
  type ProviderContractsAttestationHealth
} from "@/lib/health/provider-contracts";
import { transitionRun } from "@/lib/runs/state-machine";
import {
  ANALYSIS_DISPATCH_RECOVERY_GRACE_MS,
  getRunStore,
  type RunStore
} from "@/lib/runs/store";
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
  maintenanceHeartbeatReady?: () => Promise<boolean>;
  workflowRuntimeAttestationProbe?: () => Promise<WorkflowRuntimeAttestationHealth>;
  providerContractsAttestationProbe?: () => Promise<ProviderContractsAttestationHealth>;
}

export async function assertRecentMaintenanceHeartbeat(
  config: AppConfig,
  heartbeatReady?: () => Promise<boolean>
): Promise<void> {
  if (config.NODE_ENV !== "production") return;
  const check = heartbeatReady ?? (async () => {
    const { probeMaintenanceHeartbeat } = await import("@/lib/health/maintenance");
    return (await probeMaintenanceHeartbeat(config.DATABASE_URL)).status === "fresh";
  });
  if (!await check()) {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      "The recurring maintenance path has not completed recently.",
      { httpStatus: 503, retryable: true }
    );
  }
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
    readonly phase: "preflight" | "dispatch_claim_uncertain" | "schedule_uncertain"
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
  options: { now?: Date } = {}
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
    ADMISSION_LEASE_MS
  );
  if (!acquired) return (await dependencies.store.get(record.id)) ?? record;
  const claim: AdmissionClaim = { admissionLeaseId: acquired.admissionLeaseId };
  let claimedRecord = acquired.record;
  let failurePhase: AdmissionAttemptError["phase"] = "preflight";
  let analysisDispatchClaimId: string | null = null;
  try {
    if (claimedRecord.reservedMicroUsd < dependencies.config.MAX_RUN_COST_MICRO_USD) {
      claimedRecord = await dependencies.store.update(claimedRecord.id, (current) => ({
        ...current,
        reservedMicroUsd: dependencies.config.MAX_RUN_COST_MICRO_USD,
        updatedAt: options.now?.toISOString() ?? new Date().toISOString()
      }), claim);
    }
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

    // Permanently fence this product run before contacting Workflow. If this
    // CAS commits but its acknowledgement is lost, start() is deliberately
    // never called: recurring maintenance will terminate and clean the queued
    // run after the recovery grace period.
    failurePhase = "dispatch_claim_uncertain";
    const dispatchClaim = await dependencies.store.claimAnalysisDispatch(
      claimedRecord.id,
      claim.admissionLeaseId,
      options.now ?? new Date()
    );
    if (!dispatchClaim) {
      return (await dependencies.store.get(claimedRecord.id)) ?? claimedRecord;
    }
    analysisDispatchClaimId = dispatchClaim.analysisDispatchClaimId;
    claimedRecord = dispatchClaim.record;

    // A thrown start() can mean Vercel accepted the Workflow and only its ACK
    // was lost. The permanent claim therefore survives every outcome; neither
    // API replay nor maintenance may issue another analysis dispatch.
    failurePhase = "schedule_uncertain";
    const workflowRunId = await dependencies.schedule(claimedRecord.id);
    const settled = await dependencies.store.settleAnalysisDispatch(
      claimedRecord.id,
      dispatchClaim.analysisDispatchClaimId,
      {
        status: workflowRunId === null ? "not_dispatched" : "scheduled",
        workflowRunId,
        uncertainAt: workflowRunId === null ? options.now ?? new Date() : null
      },
      options.now ?? new Date()
    );
    return settled ?? (await dependencies.store.get(claimedRecord.id)) ?? claimedRecord;
  } catch (error) {
    if (failurePhase === "schedule_uncertain" && analysisDispatchClaimId !== null) {
      try {
        await dependencies.store.settleAnalysisDispatch(
          claimedRecord.id,
          analysisDispatchClaimId,
          {
            status: "dispatch_uncertain",
            workflowRunId: null,
            uncertainAt: options.now ?? new Date()
          },
          options.now ?? new Date()
        );
      } catch {
        // The original claim remains permanent even if recording the outcome
        // also loses its ACK. Maintenance recognizes stale `dispatching` rows.
      }
    }
    throw new AdmissionAttemptError(
      error,
      claimedRecord,
      claim,
      failurePhase
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

function hasPermanentAnalysisDispatchFence(record: RunRecord): boolean {
  // workflowRunId covers rows created by the pre-fence release. Migration 0008
  // backfills those rows, while this fallback keeps in-memory upgrades safe.
  return record.analysisDispatchClaimId !== null || record.workflowRunId !== null;
}

async function failStrandedAnalysisDispatch(
  record: RunRecord,
  dependencies: Omit<AdmissionDependencies, "schedule">,
  now: Date
): Promise<{ record: RunRecord; failureApplied: boolean }> {
  const failure = new AppError(
    "ANALYSIS_INCOMPLETE",
    "Analysis workflow delivery could not be confirmed. The run was not redispatched and was handed to maintenance for application-controlled source cleanup.",
    { httpStatus: 503, retryable: false }
  );
  const failed = await dependencies.store.update(record.id, (current) => {
    const sameDispatch = record.analysisDispatchClaimId !== null
      ? current.analysisDispatchClaimId === record.analysisDispatchClaimId
      : record.workflowRunId !== null && current.workflowRunId === record.workflowRunId;
    if (
      current.status !== "queued" ||
      !sameDispatch ||
      current.paidProviderAttemptStartedAt !== null
    ) return current;
    return {
      ...transitionRun(current, "failed", now),
      admissionLeaseId: null,
      admissionLeaseExpiresAt: null,
      result: null,
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
        request_id: failure.requestId
      }
    };
  });
  const failureApplied = failed.status === "failed" &&
    failed.error?.request_id === failure.requestId;
  if (!failureApplied) return { record: failed, failureApplied: false };
  const cleaned = await cleanupRun(failed, dependencies.store, dependencies.uploadStorage, "failed", now);
  // Delivery was uncertain, so retain the full reservation. Releasing it as a
  // zero-cost failure could reopen the daily budget while an ACK-lost Workflow
  // execution is still possible, even though the failed status fences that
  // Workflow out of the paid provider pipeline.
  if (cleaned.status === "cleanup_pending") {
    await scheduleCleanupRetry(cleaned.id, {
      store: dependencies.store,
      now: () => now
    });
  }
  return { record: cleaned, failureApplied: true };
}

export interface AdmissionRecoveryDependencies {
  config?: AppConfig;
  store?: RunStore;
  budget?: BudgetGuard;
  uploadStorage?: UploadStorage;
  schedule?: (runId: string) => Promise<string | null>;
  now?: Date;
  batchLimit?: number;
  assertWithinDeadline?: () => void;
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
  const batchLimit = Math.min(
    Math.max(Math.trunc(dependencies.batchLimit ?? ADMISSION_RECOVERY_BATCH_SIZE), 1),
    ADMISSION_RECOVERY_BATCH_SIZE
  );
  dependencies.assertWithinDeadline?.();
  const candidates = await store.listUnscheduledQueued(
    new Date(now.getTime() - ADMISSION_RECOVERY_DELAY_MS),
    batchLimit
  );
  const recoveredRunIds: string[] = [];
  const failedRunIds: string[] = [];
  const deferredRunIds: string[] = [];
  for (const candidate of candidates) {
    dependencies.assertWithinDeadline?.();
    if (new Date(candidate.expiresAt) <= now) continue;
    if (hasPermanentAnalysisDispatchFence(candidate)) {
      const dispatchClaimedAt = candidate.analysisDispatchClaimedAt ?? candidate.updatedAt;
      if (
        new Date(dispatchClaimedAt).getTime() + ANALYSIS_DISPATCH_RECOVERY_GRACE_MS >
        now.getTime()
      ) {
        deferredRunIds.push(candidate.id);
        continue;
      }
      const failed = await failStrandedAnalysisDispatch(
        candidate,
        { config, store, budget, uploadStorage },
        now
      );
      if (failed.failureApplied) failedRunIds.push(candidate.id);
      else deferredRunIds.push(candidate.id);
      dependencies.assertWithinDeadline?.();
      continue;
    }
    try {
      const recovered = await admitQueuedRun(candidate, {
        config, store, budget, uploadStorage, schedule
      }, {
        now
      });
      if (recovered.workflowRunId !== null) recoveredRunIds.push(recovered.id);
    } catch (error) {
      const attempt = error instanceof AdmissionAttemptError ? error : null;
      if (
        attempt?.phase === "dispatch_claim_uncertain" ||
        attempt?.phase === "schedule_uncertain"
      ) {
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
    dependencies.assertWithinDeadline?.();
  }
  dependencies.assertWithinDeadline?.();
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
  await assertWorkflowRuntimeAttested(config, {
    probe: dependencies.workflowRuntimeAttestationProbe
  });
  await assertProviderContractsActivelyVerified(config, {
    probe: dependencies.providerContractsAttestationProbe
  });
  await assertRecentMaintenanceHeartbeat(config, dependencies.maintenanceHeartbeatReady);
  const store = dependencies.store ?? await getRunStore();
  const input: CreateRunRequest = validateCreateRunRequest(rawInput, {
    ownerId: principal.id,
    uploadSecret: uploadNamespaceSecret(config)
  });
  // Until a separately cached, credentialed price contract is available at
  // admission time, reserve the full per-run ceiling. Operator-entered unit
  // prices are not sufficient evidence to reduce the safety reservation.
  const reservedMicroUsd = config.MAX_RUN_COST_MICRO_USD;
  const runId = crypto.randomUUID();
  const created = await store.create({
    id: runId,
    ownerId: principal.id,
    quotaKey: principal.quotaKey,
    input,
    idempotencyKey,
    reservedMicroUsd
  });
  if (
    created.created ||
    (
      created.record.status === "queued" &&
      created.record.workflowRunId === null &&
      created.record.analysisDispatchClaimId === null
    )
  ) {
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
      if (
        error.phase === "dispatch_claim_uncertain" ||
        error.phase === "schedule_uncertain"
      ) {
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
