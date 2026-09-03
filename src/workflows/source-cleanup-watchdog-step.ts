import { getRunStore } from "@/lib/runs/store";
import { runSourceCleanupWatchdog } from "@/lib/runs/source-cleanup-watchdog";
import { getUploadStorage } from "@/lib/storage/uploads";

export const maxDuration = 50;
export const SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES = 3;

export async function sourceCleanupWatchdogStep(runId: string, registrationId: string) {
  "use step";

  return runSourceCleanupWatchdog({
    store: await getRunStore(),
    storage: getUploadStorage(),
    runId,
    registrationId
  });
}

sourceCleanupWatchdogStep.maxRetries = SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES;
