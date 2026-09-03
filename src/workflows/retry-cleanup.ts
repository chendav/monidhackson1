import { retryCleanupStep } from "@/workflows/retry-cleanup-step";

export async function retryCleanupWorkflow(runId: string) {
  "use workflow";

  return retryCleanupStep(runId);
}
