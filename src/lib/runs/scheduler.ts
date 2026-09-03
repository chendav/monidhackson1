import { getConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { processRun } from "@/lib/pipeline";

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

export async function scheduleCleanupRetry(runId: string): Promise<string | null> {
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

export async function scheduleSourceCleanupWatchdog(
  runId: string,
  registrationId: string
): Promise<string | null> {
  const config = getConfig();
  if (config.DATABASE_URL && process.env.VERCEL) {
    const [{ start }, { sourceCleanupWatchdogWorkflow }] = await Promise.all([
      import("workflow/api"),
      import("@/workflows/source-cleanup-watchdog")
    ]);
    const workflowRun = await start(sourceCleanupWatchdogWorkflow, [runId, registrationId]);
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
