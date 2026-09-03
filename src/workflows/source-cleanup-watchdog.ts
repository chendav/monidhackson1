import { sleep } from "workflow";
import { sourceCleanupWatchdogStep } from "@/workflows/source-cleanup-watchdog-step";
import { SOURCE_CLEANUP_WATCHDOG_MAX_POLLS } from "@/lib/workflow-cost-policy";

export {
  SOURCE_CLEANUP_WATCHDOG_MAX_LIFECYCLE_EVENTS,
  SOURCE_CLEANUP_WATCHDOG_MAX_POLLS,
  SOURCE_CLEANUP_WATCHDOG_POLL_DELAY_MS
} from "@/lib/workflow-cost-policy";

// One package watchdog covers a parser batch of up to four documents. It checks
// immediately and at 60 and 120 seconds, placing the final attempt after the
// provider's attested 105-second network deadline. If cleanup is still
// unconfirmed, the run remains fail-closed and recurring maintenance owns the
// tail.
export async function sourceCleanupWatchdogWorkflow(runId: string, registrationIds: string[]) {
  "use workflow";

  let lastOutcome: Awaited<ReturnType<typeof sourceCleanupWatchdogStep>> = {
    runId,
    registrations: registrationIds.map((registrationId) => ({
      runId,
      registrationId,
      outcome: "cleanup_pending" as const
    })),
    allTerminal: false
  };
  for (let attempt = 0; attempt < SOURCE_CLEANUP_WATCHDOG_MAX_POLLS; attempt += 1) {
    if (attempt > 0) await sleep("60s");
    lastOutcome = await sourceCleanupWatchdogStep(runId, registrationIds);
    if (lastOutcome.allTerminal) return lastOutcome;
  }
  return lastOutcome;
}
