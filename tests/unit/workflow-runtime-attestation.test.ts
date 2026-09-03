import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { getConfig } from "@/lib/config";
import { sha256Hex, stableJson } from "@/lib/crypto";
import {
  WORKFLOW_INTERNAL_DEADLINES_MS,
  WORKFLOW_MIN_MEMORY_MB,
  WORKFLOW_NODE_RUNTIME,
  WORKFLOW_PACKAGE_VERSION,
  WORKFLOW_RUNTIME_ATTESTATION_KIND,
  WORKFLOW_RUNTIME_REQUIRED_TIMEOUT_SECONDS,
  WORKFLOW_RUNTIME_ROUTES,
  assertWorkflowRuntimeAttested,
  probeWorkflowRuntimeAttestation,
  type ReleaseAttestationRow,
  type WorkflowRuntimeAttestationPayload
} from "@/lib/health/workflow-runtime";

const now = new Date("2026-09-03T18:00:00.000Z");
const runtimeEnvironment = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_DEPLOYMENT_ID: "dpl_RuntimeProof123",
  VERCEL_URL: "rfp-xray-runtime-team.vercel.app",
  VERCEL_PROJECT_ID: "prj_RuntimeProject123",
  RFP_XRAY_VERCEL_TEAM_ID: "team_RuntimeTeam123",
  VERCEL_GIT_COMMIT_SHA: "a".repeat(40)
};

function payload(overrides: {
  issuedAt?: Date;
  expiresAt?: Date;
  flowTimeout?: number;
  stepTimeout?: number;
} = {}): WorkflowRuntimeAttestationPayload {
  return {
    version: 1,
    issued_at: (overrides.issuedAt ?? new Date(now.getTime() - 60_000)).toISOString(),
    expires_at: (overrides.expiresAt ?? new Date(now.getTime() + 60 * 60_000)).toISOString(),
    deployment: {
      id: runtimeEnvironment.VERCEL_DEPLOYMENT_ID,
      url: runtimeEnvironment.VERCEL_URL,
      target: "production",
      ready_state: "READY",
      project: { id: runtimeEnvironment.VERCEL_PROJECT_ID, name: "rfp-xray" },
      team: { id: runtimeEnvironment.RFP_XRAY_VERCEL_TEAM_ID, slug: "runtime-team" },
      git_commit_sha: runtimeEnvironment.VERCEL_GIT_COMMIT_SHA
    },
    workflow: {
      package_version: WORKFLOW_PACKAGE_VERSION,
      required_min_timeout_seconds: WORKFLOW_RUNTIME_REQUIRED_TIMEOUT_SECONDS,
      analysis_step_max_duration_seconds: WORKFLOW_RUNTIME_REQUIRED_TIMEOUT_SECONDS,
      route_functions: {
        [WORKFLOW_RUNTIME_ROUTES.flow]: {
          timeout_seconds: overrides.flowTimeout ?? 300,
          node_runtime: WORKFLOW_NODE_RUNTIME,
          memory_mb: WORKFLOW_MIN_MEMORY_MB,
          regions: ["iad1"]
        },
        [WORKFLOW_RUNTIME_ROUTES.step]: {
          timeout_seconds: overrides.stepTimeout ?? 300,
          node_runtime: WORKFLOW_NODE_RUNTIME,
          memory_mb: WORKFLOW_MIN_MEMORY_MB,
          regions: ["iad1"]
        }
      },
      internal_deadlines_ms: WORKFLOW_INTERNAL_DEADLINES_MS
    }
  };
}

function row(value: unknown): ReleaseAttestationRow {
  const candidate = value as WorkflowRuntimeAttestationPayload;
  return {
    kind: WORKFLOW_RUNTIME_ATTESTATION_KIND,
    deployment_id: candidate.deployment.id,
    deployment_url: candidate.deployment.url,
    project_id: candidate.deployment.project.id,
    team_id: candidate.deployment.team.id,
    git_commit_sha: candidate.deployment.git_commit_sha,
    payload: value,
    payload_sha256: sha256Hex(stableJson(value)),
    issued_at: candidate.issued_at,
    expires_at: candidate.expires_at
  };
}

async function inspect(
  rows: ReleaseAttestationRow[],
  environment: Partial<NodeJS.ProcessEnv> = runtimeEnvironment
) {
  return probeWorkflowRuntimeAttestation("postgresql://redacted.invalid/db", environment, now, {
    query: async () => rows
  });
}

describe("deployment-bound Workflow runtime attestation", () => {
  it("binds the validator to the installed Workflow package version", () => {
    expect(packageJson.dependencies.workflow).toBe(WORKFLOW_PACKAGE_VERSION);
    expect(packageJson.engines.node).toBe("22.x");
    expect(WORKFLOW_NODE_RUNTIME).toBe("nodejs22.x");
  });

  it("accepts only an exact current deployment binding with both 300-second routes", async () => {
    await expect(inspect([row(payload())])).resolves.toMatchObject({
      status: "attested_300s",
      deploymentId: runtimeEnvironment.VERCEL_DEPLOYMENT_ID
    });
  });

  it("reports an absent receipt as configured but unattested", async () => {
    await expect(inspect([])).resolves.toEqual({ status: "configured_unattested" });
    await expect(probeWorkflowRuntimeAttestation(undefined, runtimeEnvironment, now))
      .resolves.toEqual({ status: "configured_unattested" });
  });

  it("enforces the asynchronous gate only for production execution", async () => {
    await expect(assertWorkflowRuntimeAttested(getConfig({ NODE_ENV: "test" }), {
      probe: async () => ({ status: "mismatch" })
    })).resolves.toBeNull();
    await expect(assertWorkflowRuntimeAttested(getConfig({ NODE_ENV: "production" }), {
      probe: async () => ({ status: "configured_unattested" })
    })).rejects.toMatchObject({ code: "ANALYSIS_INCOMPLETE", httpStatus: 503 });
  });

  it("reuses only the branded just-validated capability at the nested pipeline boundary", async () => {
    const production = getConfig({ NODE_ENV: "production" });
    const probe = async () => ({
      status: "attested_300s" as const,
      deploymentId: runtimeEnvironment.VERCEL_DEPLOYMENT_ID,
      expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      payloadSha256: "a".repeat(64)
    });
    const capability = await assertWorkflowRuntimeAttested(production, {
      environment: runtimeEnvironment,
      now,
      probe
    });
    expect(capability).not.toBeNull();
    await expect(assertWorkflowRuntimeAttested(production, {
      environment: runtimeEnvironment,
      now,
      capability: capability!,
      probe: async () => { throw new Error("must not query twice"); }
    })).resolves.toBe(capability);
  });

  it("rejects a receipt for a different runtime identity", async () => {
    await expect(inspect([row(payload())], {
      ...runtimeEnvironment,
      VERCEL_DEPLOYMENT_ID: "dpl_DifferentDeployment123"
    })).resolves.toEqual({ status: "mismatch" });
  });

  it("distinguishes an expired otherwise-valid receipt", async () => {
    const value = payload({
      issuedAt: new Date(now.getTime() - 2 * 60 * 60_000),
      expiresAt: new Date(now.getTime() - 1)
    });
    await expect(inspect([row(value)])).resolves.toEqual({ status: "expired" });
  });

  it("rejects a receipt that omits an exact Workflow route", async () => {
    const value = structuredClone(payload()) as unknown as Record<string, unknown>;
    const workflow = value.workflow as Record<string, unknown>;
    const routes = workflow.route_functions as Record<string, unknown>;
    delete routes[WORKFLOW_RUNTIME_ROUTES.step];
    await expect(inspect([row(value)])).resolves.toEqual({ status: "mismatch" });
  });

  it("rejects a 299-second Workflow route", async () => {
    await expect(inspect([row(payload({ stepTimeout: 299 }))]))
      .resolves.toEqual({ status: "mismatch" });
  });

  it("rejects a route runtime, memory, or region outside the release envelope", async () => {
    for (const mutate of [
      (route: Record<string, unknown>) => { route.node_runtime = "nodejs24.x"; },
      (route: Record<string, unknown>) => { route.memory_mb = 1024; },
      (route: Record<string, unknown>) => { route.regions = []; }
    ]) {
      const value = structuredClone(payload()) as unknown as Record<string, unknown>;
      const workflow = value.workflow as Record<string, unknown>;
      const routes = workflow.route_functions as Record<string, Record<string, unknown>>;
      mutate(routes[WORKFLOW_RUNTIME_ROUTES.step]);
      await expect(inspect([row(value)])).resolves.toEqual({ status: "mismatch" });
    }
  });

  it("rejects a fingerprint or duplicated-column mismatch", async () => {
    const valid = row(payload());
    await expect(inspect([{ ...valid, project_id: "prj_DifferentProject123" }]))
      .resolves.toEqual({ status: "mismatch" });
    await expect(inspect([{ ...valid, payload_sha256: "b".repeat(64) }]))
      .resolves.toEqual({ status: "mismatch" });
  });
});
