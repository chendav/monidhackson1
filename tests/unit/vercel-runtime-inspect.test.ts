import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import vercelConfig from "../../vercel.json";
import {
  WORKFLOW_INTERNAL_DEADLINES_MS,
  WORKFLOW_PACKAGE_VERSION
} from "@/lib/health/workflow-runtime";
// @ts-expect-error The release utility is deliberately executable plain ESM.
import { buildReleaseSubprocessEnvironment, buildWorkflowRuntimeAttestation, parseReleaseArguments, WORKFLOW_ROUTES } from "../../scripts/attest-vercel-runtime.mjs";

interface InspectOutput {
  id: string;
  name: string;
  url: string;
  target: string;
  readyState: string;
  contextName: string;
  builds: Array<{
    output: Array<{
      path: string;
      type: string;
      lambda: {
        timeout: number;
        runtime: string;
        memorySize: number;
        deployedTo: string[];
      };
    }>;
  }>;
}

const project = {
  projectId: "prj_RuntimeProject123",
  orgId: "team_RuntimeTeam123",
  projectName: "rfp-xray"
};

function inspection(timeout = 300): InspectOutput {
  return {
    id: "dpl_RuntimeProof123",
    name: "rfp-xray",
    url: "rfp-xray-runtime-team.vercel.app",
    target: "production",
    readyState: "READY",
    contextName: "runtime-team",
    builds: [{
      output: (WORKFLOW_ROUTES as string[]).map((path) => ({
        path,
        type: "lambda",
        lambda: {
          timeout,
          runtime: "nodejs22.x",
          memorySize: 2048,
          deployedTo: ["iad1"]
        }
      }))
    }]
  };
}

function build(value = inspection()) {
  return buildWorkflowRuntimeAttestation({
    inspection: value,
    project,
    scope: "runtime-team",
    gitCommitSha: "a".repeat(40),
    workflowPackageVersion: "4.8.5",
    issuedAt: new Date("2026-09-03T18:00:00.000Z"),
    expiresAt: new Date("2026-09-04T18:00:00.000Z")
  });
}

describe("release-only Vercel inspect parser", () => {
  it("pins Fluid Compute and the inspect CLI in checked-in release configuration", () => {
    expect(vercelConfig).toMatchObject({
      $schema: "https://openapi.vercel.sh/vercel.json",
      fluid: true
    });
    expect(packageJson.devDependencies.vercel).toBe("59.11.2");
  });

  it("requires an explicit kind-specific confirmation before storing", () => {
    expect(() => parseReleaseArguments([
      "--deployment", "https://rfp-xray.example",
      "--scope", "runtime-team"
    ])).toThrow("STORE_NOT_CONFIRMED");
    expect(parseReleaseArguments([
      "--deployment", "https://rfp-xray.example",
      "--scope", "runtime-team",
      "--confirm-store", "vercel_workflow_runtime/v1"
    ])).toMatchObject({ scope: "runtime-team", ttlHours: 24 });
  });

  it("does not forward application, database, provider, or storage secrets to child processes", () => {
    const child = buildReleaseSubprocessEnvironment({
      PATH: "safe-path",
      DATABASE_URL: "must-not-egress",
      MONID_API_KEY: "must-not-egress",
      OPENAI_API_KEY: "must-not-egress",
      S3_SECRET_ACCESS_KEY: "must-not-egress",
      TURNSTILE_SECRET_KEY: "must-not-egress",
      VERCEL_TOKEN: "vercel-only"
    }, true);
    expect(child).toMatchObject({ PATH: "safe-path", VERCEL_TOKEN: "vercel-only", CI: "1" });
    expect(child).not.toHaveProperty("DATABASE_URL");
    expect(child).not.toHaveProperty("MONID_API_KEY");
    expect(child).not.toHaveProperty("OPENAI_API_KEY");
    expect(child).not.toHaveProperty("S3_SECRET_ACCESS_KEY");
    expect(child).not.toHaveProperty("TURNSTILE_SECRET_KEY");
  });

  it("selects only the two exact non-secret Workflow timeout fields", () => {
    const result = build();
    expect(result.payload.workflow.route_functions).toEqual({
      [WORKFLOW_ROUTES[0]]: {
        timeout_seconds: 300,
        node_runtime: "nodejs22.x",
        memory_mb: 2048,
        regions: ["iad1"]
      },
      [WORKFLOW_ROUTES[1]]: {
        timeout_seconds: 300,
        node_runtime: "nodejs22.x",
        memory_mb: 2048,
        regions: ["iad1"]
      }
    });
    expect(result.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.payload.workflow.package_version).toBe(WORKFLOW_PACKAGE_VERSION);
    expect(result.payload.workflow.internal_deadlines_ms).toEqual(WORKFLOW_INTERNAL_DEADLINES_MS);
  });

  it("rejects a wrong route and a 299-second route", () => {
    const wrongRoute = inspection();
    wrongRoute.builds[0].output[1].path = ".well-known/workflow/v1/not-step";
    expect(() => build(wrongRoute)).toThrow("WORKFLOW_ROUTE_MISSING_OR_DUPLICATED");
    expect(() => build(inspection(299))).toThrow("WORKFLOW_ROUTE_TIMEOUT_TOO_SHORT");
  });

  it("rejects the wrong Node runtime, undersized memory, or an empty region set", () => {
    const wrongRuntime = inspection();
    wrongRuntime.builds[0].output[1].lambda.runtime = "nodejs24.x";
    expect(() => build(wrongRuntime)).toThrow("WORKFLOW_NODE_RUNTIME_MISMATCH");
    const smallMemory = inspection();
    smallMemory.builds[0].output[1].lambda.memorySize = 1024;
    expect(() => build(smallMemory)).toThrow("WORKFLOW_MEMORY_TOO_SMALL");
    const noRegions = inspection();
    noRegions.builds[0].output[1].lambda.deployedTo = [];
    expect(() => build(noRegions)).toThrow("WORKFLOW_REGIONS_INVALID");
  });

  it("rejects non-production, non-ready, and wrong-project deployments", () => {
    expect(() => build({ ...inspection(), target: "preview" })).toThrow("NOT_PRODUCTION");
    expect(() => build({ ...inspection(), readyState: "BUILDING" })).toThrow("DEPLOYMENT_NOT_READY");
    expect(() => build({ ...inspection(), name: "other-project" })).toThrow("WRONG_PROJECT");
  });
});
