export const REDELIVERY_PROBE_ENVIRONMENT = "preview" as const;
export const REDELIVERY_PROBE_PLATFORM = "linux" as const;
export const REDELIVERY_PROBE_MAX_RETRIES = 1 as const;

export interface RedeliveryProbeBinding {
  deploymentId: string;
  gitCommitSha: string;
  projectId: string;
  teamId: string;
  manifestSha256: string;
  configSha256: string;
}

export interface RedeliveryProbeRuntime {
  deploymentId: string | undefined;
  gitCommitSha: string | undefined;
  projectId: string | undefined;
  teamId: string | undefined;
  environment: string | undefined;
  platform: string;
  attempt: number;
}

export type RedeliveryProbeRejectReason =
  | "INVALID_BINDING"
  | "NOT_PREVIEW"
  | "NOT_LINUX"
  | "DEPLOYMENT_MISMATCH"
  | "GIT_SHA_MISMATCH"
  | "PROJECT_MISMATCH"
  | "TEAM_MISMATCH"
  | "INVALID_ATTEMPT";

export type RedeliveryProbeDecision =
  | { action: "kill" }
  | { action: "complete" }
  | { action: "reject"; reason: RedeliveryProbeRejectReason };

const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const PROJECT_ID = /^prj_[A-Za-z0-9]+$/;
const TEAM_ID = /^(?:team|user)_[A-Za-z0-9]+$/;
const SHA256 = /^[a-f0-9]{64}$/;

function hasValidBinding(binding: RedeliveryProbeBinding): boolean {
  return DEPLOYMENT_ID.test(binding.deploymentId) &&
    GIT_SHA.test(binding.gitCommitSha) &&
    PROJECT_ID.test(binding.projectId) &&
    TEAM_ID.test(binding.teamId) &&
    SHA256.test(binding.manifestSha256) &&
    SHA256.test(binding.configSha256);
}

/**
 * Fail-closed admission for the destructive probe step. The first attempt may
 * SIGKILL only when every immutable Preview binding matches the Vercel runtime;
 * the one permitted redelivery completes, and every other attempt is rejected.
 */
export function decideRedeliveryProbe(
  binding: RedeliveryProbeBinding,
  runtime: RedeliveryProbeRuntime
): RedeliveryProbeDecision {
  if (!hasValidBinding(binding)) {
    return { action: "reject", reason: "INVALID_BINDING" };
  }
  if (runtime.environment !== REDELIVERY_PROBE_ENVIRONMENT) {
    return { action: "reject", reason: "NOT_PREVIEW" };
  }
  if (runtime.platform !== REDELIVERY_PROBE_PLATFORM) {
    return { action: "reject", reason: "NOT_LINUX" };
  }
  if (runtime.deploymentId !== binding.deploymentId) {
    return { action: "reject", reason: "DEPLOYMENT_MISMATCH" };
  }
  if (runtime.gitCommitSha?.toLowerCase() !== binding.gitCommitSha) {
    return { action: "reject", reason: "GIT_SHA_MISMATCH" };
  }
  if (runtime.projectId !== binding.projectId) {
    return { action: "reject", reason: "PROJECT_MISMATCH" };
  }
  if (runtime.teamId !== binding.teamId) {
    return { action: "reject", reason: "TEAM_MISMATCH" };
  }
  if (runtime.attempt === 1) {
    return { action: "kill" };
  }
  if (runtime.attempt === 2) {
    return { action: "complete" };
  }
  return { action: "reject", reason: "INVALID_ATTEMPT" };
}
