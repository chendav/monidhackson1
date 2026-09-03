import { sleep } from "workflow";
import {
  SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES,
  sourceCleanupWatchdogStep
} from "@/workflows/source-cleanup-watchdog-step";

// Poll quickly through the first capture-SLA window, then back off while the
// five-minute signed source URL may still be in use. The bounded loop consumes
// at most 421 Workflow lifecycle events even if every step consumes all three
// retries (three events per attempt, two per sleep, plus three run events). If
// deletion is still unconfirmed, the run remains fail-closed and recurring
// maintenance owns the tail.
export const SOURCE_CLEANUP_WATCHDOG_FAST_POLLS = 7;
export const SOURCE_CLEANUP_WATCHDOG_MAX_POLLS = 30;
export const SOURCE_CLEANUP_WATCHDOG_BACKOFF_MS = 30_000;
export const SOURCE_CLEANUP_WATCHDOG_MAX_LIFECYCLE_EVENTS =
  SOURCE_CLEANUP_WATCHDOG_MAX_POLLS *
    (SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES + 1) * 3 +
  (SOURCE_CLEANUP_WATCHDOG_MAX_POLLS - 1) * 2 +
  3;

export function sourceCleanupWatchdogPollDelayMs(attempt: number) {
  return attempt < SOURCE_CLEANUP_WATCHDOG_FAST_POLLS - 1
    ? 10_000
    : SOURCE_CLEANUP_WATCHDOG_BACKOFF_MS;
}

export async function sourceCleanupWatchdogWorkflow(runId: string, registrationId: string) {
  "use workflow";

  for (let attempt = 0; attempt < SOURCE_CLEANUP_WATCHDOG_MAX_POLLS; attempt += 1) {
    const outcome = await sourceCleanupWatchdogStep(runId, registrationId);
    if (["missing", "complete", "cancelled"].includes(outcome.outcome)) return outcome;
    if (attempt < SOURCE_CLEANUP_WATCHDOG_MAX_POLLS - 1) {
      await sleep(sourceCleanupWatchdogPollDelayMs(attempt) === 10_000 ? "10s" : "30s");
    }
  }
  return { runId, registrationId, outcome: "cleanup_pending" as const };
}
