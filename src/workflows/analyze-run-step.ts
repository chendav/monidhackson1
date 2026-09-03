import { processRun } from "@/lib/pipeline";
import { getConfig } from "@/lib/config";
import { assertWorkflowRuntimeAttested } from "@/lib/health/workflow-runtime";
import { assertProviderContractsActivelyVerified } from "@/lib/health/provider-contracts";

// Keep the source declaration aligned with the monolith's attested 300-second
// envelope even though Workflow 4.8.5 currently emits `maxDuration: "max"`
// for the generated route. The deployment receipt still has final authority.
export const maxDuration = 300;

export async function processRunStep(runId: string) {
  "use step";

  const config = getConfig();
  const workflowRuntimeCapability = await assertWorkflowRuntimeAttested(config);
  const providerContractsCapability = await assertProviderContractsActivelyVerified(config);
  const record = await processRun(runId, {
    workflowRuntimeCapability: workflowRuntimeCapability ?? undefined,
    providerContractsCapability: providerContractsCapability ?? undefined
  });
  return { runId: record.id, status: record.status, expiresAt: record.expiresAt };
}

// Retrying the whole step could repeat paid provider calls after a late
// persistence or cleanup failure. Provider calls own their bounded retries.
processRunStep.maxRetries = 0;
