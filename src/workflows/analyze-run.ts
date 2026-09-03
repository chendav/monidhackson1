import { sleep } from "workflow";
import { processRunStep } from "@/workflows/analyze-run-step";
import { expireRunStep } from "@/workflows/expire-runs-step";

export async function analyzeRunWorkflow(runId: string) {
  "use workflow";

  const outcome = await processRunStep(runId);
  await sleep(new Date(outcome.expiresAt));
  return expireRunStep(runId);
}
