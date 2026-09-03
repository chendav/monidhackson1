import { processRun } from "@/lib/pipeline";

// `workflow/next` emits maxDuration="max" for its generated step endpoint.
// Live deployments require Vercel Pro/Fluid Compute and this explicit 800s
// ceiling; the pipeline reserves only 600s for source/Monid networking and
// 120s for one OpenAI attempt.
export const maxDuration = 800;

export async function processRunStep(runId: string) {
  "use step";

  const record = await processRun(runId);
  return { runId: record.id, status: record.status, expiresAt: record.expiresAt };
}

// Retrying the whole step could repeat paid provider calls after a late
// persistence or cleanup failure. Provider calls own their bounded retries.
processRunStep.maxRetries = 0;
