import { createHash } from "node:crypto";
import { getStepMetadata } from "workflow";
import {
  decideRedeliveryProbe,
  REDELIVERY_PROBE_MAX_RETRIES,
  type RedeliveryProbeBinding
} from "@/workflows/redelivery-probe-policy";

export interface RedeliveryProbeResult {
  deploymentId: string;
  gitCommitSha: string;
  projectId: string;
  teamId: string;
  manifestSha256: string;
  configSha256: string;
  environment: "preview";
  platform: "linux";
  attempt: 2;
  stepIdSha256: string;
  completedAt: string;
}

export async function redeliveryProbeStep(
  binding: RedeliveryProbeBinding
): Promise<RedeliveryProbeResult> {
  "use step";

  const metadata = getStepMetadata();
  const decision = decideRedeliveryProbe(binding, {
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
    gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA,
    projectId: process.env.VERCEL_PROJECT_ID,
    teamId: process.env.RFP_XRAY_VERCEL_TEAM_ID ?? process.env.VERCEL_ORG_ID,
    environment: process.env.VERCEL_ENV,
    platform: process.platform,
    attempt: metadata.attempt
  });

  if (decision.action === "reject") {
    throw new Error(`REDELIVERY_PROBE_POLICY_REJECTED:${decision.reason}`);
  }

  if (decision.action === "kill") {
    process.kill(process.pid, "SIGKILL");
    // A successful SIGKILL never returns. Reaching this line must be visible as
    // a hard probe failure rather than being mistaken for a redelivery signal.
    throw new Error("REDELIVERY_PROBE_SIGKILL_RETURNED");
  }

  return {
    ...binding,
    environment: "preview",
    platform: "linux",
    attempt: 2,
    stepIdSha256: createHash("sha256").update(metadata.stepId).digest("hex"),
    completedAt: metadata.stepStartedAt.toISOString()
  };
}

redeliveryProbeStep.maxRetries = REDELIVERY_PROBE_MAX_RETRIES;
