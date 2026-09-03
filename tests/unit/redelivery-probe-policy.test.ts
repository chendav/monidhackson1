import { describe, expect, it } from "vitest";
import {
  decideRedeliveryProbe,
  REDELIVERY_PROBE_MAX_RETRIES,
  type RedeliveryProbeBinding,
  type RedeliveryProbeRuntime
} from "@/workflows/redelivery-probe-policy";
import { redeliveryProbeStep } from "@/workflows/redelivery-probe-step";

const binding: RedeliveryProbeBinding = {
  deploymentId: "dpl_PreviewDeployment123",
  gitCommitSha: "a".repeat(40),
  projectId: "prj_RfpXrayProject123",
  teamId: "team_RfpXrayTeam123",
  manifestSha256: "b".repeat(64),
  configSha256: "c".repeat(64)
};

const runtime: RedeliveryProbeRuntime = {
  deploymentId: binding.deploymentId,
  gitCommitSha: binding.gitCommitSha,
  projectId: binding.projectId,
  teamId: binding.teamId,
  environment: "preview",
  platform: "linux",
  attempt: 1
};

describe("Preview-only Workflow redelivery probe policy", () => {
  it("kills only attempt one and completes only the single redelivery", () => {
    expect(decideRedeliveryProbe(binding, runtime)).toEqual({ action: "kill" });
    expect(decideRedeliveryProbe(binding, { ...runtime, attempt: 2 })).toEqual({
      action: "complete"
    });
    expect(decideRedeliveryProbe(binding, { ...runtime, attempt: 0 })).toEqual({
      action: "reject",
      reason: "INVALID_ATTEMPT"
    });
    expect(decideRedeliveryProbe(binding, { ...runtime, attempt: 3 })).toEqual({
      action: "reject",
      reason: "INVALID_ATTEMPT"
    });
    expect(REDELIVERY_PROBE_MAX_RETRIES).toBe(1);
    expect(redeliveryProbeStep.maxRetries).toBe(1);
  });

  it.each([
    ["environment", "production", "NOT_PREVIEW"],
    ["platform", "win32", "NOT_LINUX"],
    ["deploymentId", "dpl_OtherDeployment", "DEPLOYMENT_MISMATCH"],
    ["gitCommitSha", "d".repeat(40), "GIT_SHA_MISMATCH"],
    ["projectId", "prj_OtherProject", "PROJECT_MISMATCH"],
    ["teamId", "team_OtherTeam", "TEAM_MISMATCH"]
  ] as const)("rejects a mismatched %s binding", (key, value, reason) => {
    expect(decideRedeliveryProbe(binding, { ...runtime, [key]: value })).toEqual({
      action: "reject",
      reason
    });
  });

  it.each([
    [{ ...binding, deploymentId: "production" }],
    [{ ...binding, gitCommitSha: "A".repeat(40) }],
    [{ ...binding, projectId: "project-unsafe" }],
    [{ ...binding, teamId: "team_bad/slash" }],
    [{ ...binding, manifestSha256: "short" }],
    [{ ...binding, configSha256: "z".repeat(64) }]
  ])("rejects malformed immutable bindings", (candidate) => {
    expect(decideRedeliveryProbe(candidate, runtime)).toEqual({
      action: "reject",
      reason: "INVALID_BINDING"
    });
  });
});
