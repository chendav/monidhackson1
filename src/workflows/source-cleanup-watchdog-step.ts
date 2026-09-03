import { getRunStore } from "@/lib/runs/store";
import {
  runSourceCleanupWatchdog,
  type SourceCleanupWatchdogOutcome
} from "@/lib/runs/source-cleanup-watchdog";
import { getUploadStorage } from "@/lib/storage/uploads";
import {
  SOURCE_CLEANUP_WATCHDOG_REGISTRATIONS_PER_BATCH,
  SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES,
  WORKFLOW_HELPER_MAX_DURATION_SECONDS
} from "@/lib/workflow-cost-policy";

export { SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES } from "@/lib/workflow-cost-policy";

export const maxDuration = WORKFLOW_HELPER_MAX_DURATION_SECONDS;
export async function sourceCleanupWatchdogStep(runId: string, registrationIds: string[]) {
  "use step";

  const uniqueRegistrationIds = [...new Set(registrationIds)];
  if (
    uniqueRegistrationIds.length < 1 ||
    uniqueRegistrationIds.length > SOURCE_CLEANUP_WATCHDOG_REGISTRATIONS_PER_BATCH ||
    uniqueRegistrationIds.length !== registrationIds.length
  ) {
    throw new Error("A source cleanup watchdog step requires one to four unique registrations.");
  }

  const store = await getRunStore();
  const storage = getUploadStorage();
  const registrations: Array<{
    runId: string;
    registrationId: string;
    outcome: SourceCleanupWatchdogOutcome;
  }> = [];
  for (const registrationId of uniqueRegistrationIds) {
    try {
      registrations.push(await runSourceCleanupWatchdog({
        store,
        storage,
        runId,
        registrationId
      }));
    } catch {
      // Continue through the batch so one transient deletion failure cannot
      // prevent the remaining registrations from receiving this poll. The
      // next 60-second poll and recurring maintenance own the retry tail.
      registrations.push({ runId, registrationId, outcome: "cleanup_pending" });
    }
  }
  const terminalOutcomes: SourceCleanupWatchdogOutcome[] = [
    "missing",
    "complete",
    "cancelled"
  ];
  return {
    runId,
    registrations,
    allTerminal: registrations.every(({ outcome }) => terminalOutcomes.includes(outcome))
  };
}

sourceCleanupWatchdogStep.maxRetries = SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES;
