import { sleep } from "workflow";
import { retryCleanupStep } from "@/workflows/retry-cleanup-step";

export async function retryCleanupWorkflow(runId: string) {
  "use workflow";

  for (let attempt = 0; attempt < 96; attempt += 1) {
    if (attempt > 0) await sleep("15m");
    const outcome = await retryCleanupStep(runId);
    if (outcome.status !== "cleanup_pending") return outcome;
  }
  return { runId, status: "cleanup_pending" as const };
}
