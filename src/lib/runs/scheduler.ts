import { getConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { processRun } from "@/lib/pipeline";
import { getRunStore, type RunStore } from "@/lib/runs/store";
import { SOURCE_CLEANUP_WATCHDOG_REGISTRATIONS_PER_BATCH } from "@/lib/workflow-cost-policy";

export async function scheduleRun(runId: string): Promise<string | null> {
  const config = getConfig();
  if (config.DATABASE_URL && process.env.VERCEL) {
    const [{ start }, { analyzeRunWorkflow }] = await Promise.all([
      import("workflow/api"),
      import("@/workflows/analyze-run")
    ]);
    const workflowRun = await start(analyzeRunWorkflow, [runId]);
    return workflowRun.runId;
  }

  if (config.NODE_ENV === "production") {
    throw new AppError("ANALYSIS_INCOMPLETE", "Vercel Workflow is not configured.", {
      httpStatus: 503,
      retryable: true
    });
  }

  queueMicrotask(() => {
    void processRun(runId).catch(() => undefined);
  });
  return null;
}

export async function scheduleIncomingUploadSweep(expiresAt: string): Promise<string | null> {
  const config = getConfig();
  if (config.DATABASE_URL && process.env.VERCEL) {
    const [{ start }, { sweepIncomingUploadsWorkflow }] = await Promise.all([
      import("workflow/api"),
      import("@/workflows/sweep-incoming-uploads")
    ]);
    const workflowRun = await start(sweepIncomingUploadsWorkflow, [expiresAt]);
    return workflowRun.runId;
  }
  if (config.NODE_ENV === "production") {
    throw new AppError("ANALYSIS_INCOMPLETE", "The incoming-upload sweeper is not configured.", {
      httpStatus: 503,
      retryable: true
    });
  }
  return null;
}

async function dispatchCleanupRetryWorkflow(runId: string): Promise<string | null> {
  const config = getConfig();
  if (config.DATABASE_URL && process.env.VERCEL) {
    const [{ start }, { retryCleanupWorkflow }] = await Promise.all([
      import("workflow/api"),
      import("@/workflows/retry-cleanup")
    ]);
    const workflowRun = await start(retryCleanupWorkflow, [runId]);
    return workflowRun.runId;
  }
  if (config.NODE_ENV === "production") {
    throw new AppError("SOURCE_CLEANUP_PENDING", "The cleanup retry workflow is not configured.", {
      httpStatus: 503,
      retryable: true
    });
  }
  return null;
}

export interface CleanupRetrySchedulingDependencies {
  store?: RunStore;
  dispatch?: (runId: string) => Promise<string | null>;
  now?: () => Date;
}

/**
 * Claims the one allowed standalone cleanup-retry Workflow before contacting
 * Vercel. The claim is permanent: a thrown dispatch can mean the Workflow was
 * accepted but its acknowledgement was lost, so retrying that dispatch would
 * destroy the per-run event/cost bound. An uncertain or local no-op dispatch
 * is made immediately eligible for the idempotent maintenance cleanup path.
 * If the claim UPDATE itself commits but its acknowledgement is lost, the
 * persisted `dispatching` row becomes maintenance-eligible after a short
 * grace; callers never blind-retry the standalone Workflow.
 */
export async function scheduleCleanupRetry(
  runId: string,
  dependencies: CleanupRetrySchedulingDependencies = {}
): Promise<string | null> {
  const store = dependencies.store ?? await getRunStore();
  const now = dependencies.now?.() ?? new Date();
  let claim: Awaited<ReturnType<RunStore["claimCleanupRetry"]>>;
  try {
    claim = await store.claimCleanupRetry(runId, now);
  } catch {
    throw new AppError(
      "SOURCE_CLEANUP_PENDING",
      "Cleanup retry admission could not be confirmed. Any committed claim will be recovered by scheduled maintenance without a blind redispatch.",
      { httpStatus: 503, retryable: true }
    );
  }
  if (!claim) {
    return (await store.get(runId))?.cleanupRetryWorkflowRunId ?? null;
  }

  const dispatch = dependencies.dispatch ?? dispatchCleanupRetryWorkflow;
  try {
    const workflowRunId = await dispatch(runId);
    await store.settleCleanupRetryDispatch(runId, claim.cleanupRetryClaimId, {
      status: workflowRunId === null ? "not_dispatched" : "scheduled",
      workflowRunId,
      uncertainAt: workflowRunId === null ? now : null
    }, now);
    return workflowRunId;
  } catch {
    // Do not clear the claim. `start()` may have committed before throwing, so
    // another standalone dispatch is never safe. Maintenance cleanup is the
    // bounded fallback and can race safely with an accepted retry Workflow.
    try {
      await store.settleCleanupRetryDispatch(runId, claim.cleanupRetryClaimId, {
        status: "dispatch_uncertain",
        workflowRunId: null,
        uncertainAt: now
      }, now);
    } catch {
      // Preserve the dispatch error. The original CAS claim still prevents a
      // second Workflow even when recording the uncertain outcome also fails.
    }
    throw new AppError(
      "SOURCE_CLEANUP_PENDING",
      "Cleanup retry dispatch could not be confirmed. No second standalone retry will be dispatched; scheduled maintenance will continue cleanup.",
      { httpStatus: 503, retryable: true }
    );
  }
}

export async function scheduleSourceCleanupWatchdog(
  runId: string,
  registrationIds: string[]
): Promise<string | null> {
  const uniqueRegistrationIds = [...new Set(registrationIds)];
  if (
    uniqueRegistrationIds.length < 1 ||
    uniqueRegistrationIds.length > SOURCE_CLEANUP_WATCHDOG_REGISTRATIONS_PER_BATCH ||
    uniqueRegistrationIds.length !== registrationIds.length
  ) {
    throw new AppError(
      "SOURCE_CLEANUP_PENDING",
      `A source cleanup watchdog batch must contain one to ${SOURCE_CLEANUP_WATCHDOG_REGISTRATIONS_PER_BATCH} unique registrations.`,
      { httpStatus: 503, retryable: false }
    );
  }
  const config = getConfig();
  if (config.DATABASE_URL && process.env.VERCEL) {
    const [{ start }, { sourceCleanupWatchdogWorkflow }] = await Promise.all([
      import("workflow/api"),
      import("@/workflows/source-cleanup-watchdog")
    ]);
    const workflowRun = await start(sourceCleanupWatchdogWorkflow, [runId, uniqueRegistrationIds]);
    return workflowRun.runId;
  }
  if (config.NODE_ENV === "production") {
    throw new AppError(
      "SOURCE_CLEANUP_PENDING",
      "The independent source cleanup watchdog is not configured.",
      { httpStatus: 503, retryable: true }
    );
  }
  return null;
}
