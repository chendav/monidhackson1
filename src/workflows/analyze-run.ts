import { sleep } from "workflow";
import { processRunStep } from "@/workflows/analyze-run-step";
import { expireRunStep } from "@/workflows/expire-runs-step";
import { retryCleanupStep } from "@/workflows/retry-cleanup-step";

export async function analyzeRunWorkflow(runId: string) {
  "use workflow";

  const outcome = await processRunStep(runId);
  if (outcome.status === "cleanup_pending") {
    for (let attempt = 0; attempt < 96; attempt += 1) {
      if (attempt > 0) await sleep("15m");
      const retried = await retryCleanupStep(runId);
      if (retried.status !== "cleanup_pending") break;
    }
  }
  await sleep(new Date(outcome.expiresAt));
  return expireRunStep(runId);
}
