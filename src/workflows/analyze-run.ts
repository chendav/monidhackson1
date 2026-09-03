import { processRunStep } from "@/workflows/analyze-run-step";

export async function analyzeRunWorkflow(runId: string) {
  "use workflow";

  // Five-minute maintenance owns cleanup retries and expiry. Keeping the
  // per-run analysis Workflow to one step makes the generated route envelope
  // finite and prevents a 24-hour durable sleep from multiplying flow-handler
  // invocations.
  return processRunStep(runId);
}
