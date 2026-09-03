import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

interface ProbeBinding {
  deploymentId: string;
  gitCommitSha: string;
  projectId: string;
  teamId: string;
  manifestSha256: string;
  configSha256: string;
}

interface ProbeOptions {
  mode: "start" | "verify-existing";
  existingRunId: string | null;
  environment: "preview";
  token: string;
  binding: ProbeBinding;
  timeoutMs: number;
  startAckTimeoutMs: number;
  pollIntervalMs: number;
}

const runnerPromise = import(
  new URL("../../scripts/live-recovery-probe.mjs", import.meta.url).href
) as Promise<{
  REDELIVERY_PROBE_WORKFLOW_ID: string;
  RecoveryProbeError: new (code: string, stage: string) => Error & {
    code: string;
    stage: string;
  };
  parseRecoveryProbeOptions: (environment: Record<string, string | undefined>) => ProbeOptions;
  buildCleanChildEnvironment: (
    options: ProbeOptions,
    inherited?: Record<string, string | undefined>
  ) => Record<string, string>;
  verifyPreviewDeployment: (
    options: ProbeOptions,
    fetcher?: typeof fetch
  ) => Promise<Record<string, unknown>>;
  startWorkflowExactlyOnce: (
    startAttempt: () => Promise<Record<string, unknown>>
  ) => Promise<string>;
  resolveRecoveryProbeRunId: (
    options: ProbeOptions,
    startAttempt: () => Promise<Record<string, unknown>>
  ) => Promise<string>;
  estimateVercelProbeCost: (eventCount: number) => {
    actual_micro_usd: null;
    estimated_micro_usd: number;
    components: Array<Record<string, unknown>>;
  };
  buildRecoveryEvidence: (input: {
    binding: ProbeBinding;
    run: Record<string, unknown>;
    events: Array<Record<string, unknown>>;
    steps: Array<Record<string, unknown>>;
    output: Record<string, unknown>;
    startedAt: Date;
    finishedAt: Date;
    mode?: "start" | "verify-existing";
  }) => Record<string, unknown>;
}>;

const binding: ProbeBinding = {
  deploymentId: "dpl_PreviewDeployment123",
  gitCommitSha: "a".repeat(40),
  projectId: "prj_RfpXrayProject123",
  teamId: "team_RfpXrayTeam123",
  manifestSha256: "b".repeat(64),
  configSha256: "c".repeat(64)
};

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    RFP_XRAY_ALLOW_RECOVERY_PROBE: "true",
    RFP_XRAY_RECOVERY_ENVIRONMENT: "preview",
    WORKFLOW_VERCEL_AUTH_TOKEN: "vercel-test-token",
    RFP_XRAY_RECOVERY_DEPLOYMENT_ID: binding.deploymentId,
    RFP_XRAY_RECOVERY_GIT_COMMIT_SHA: binding.gitCommitSha,
    RFP_XRAY_RECOVERY_PROJECT_ID: binding.projectId,
    RFP_XRAY_RECOVERY_TEAM_ID: binding.teamId,
    RFP_XRAY_RECOVERY_MANIFEST_SHA256: binding.manifestSha256,
    RFP_XRAY_RECOVERY_CONFIG_SHA256: binding.configSha256,
    ...overrides
  };
}

function event(
  runId: string,
  eventId: string,
  eventType: string,
  correlationId?: string,
  attempt?: number,
  createdAt = "2026-09-03T12:00:00.000Z"
) {
  return {
    runId,
    eventId,
    eventType,
    createdAt: new Date(createdAt),
    ...(correlationId ? { correlationId } : {}),
    ...(attempt === undefined ? {} : { eventData: { attempt } })
  };
}

function materializedStep(runId: string, stepId: string, overrides: Record<string, unknown> = {}) {
  return {
    runId,
    stepId,
    stepName: "step//./src/workflows/redelivery-probe-step//redeliveryProbeStep",
    status: "completed",
    attempt: 2,
    createdAt: new Date("2026-09-03T12:00:00.000Z"),
    updatedAt: new Date("2026-09-03T12:00:01.000Z"),
    ...overrides
  };
}

describe("provider-free live Workflow recovery verifier", () => {
  it("requires explicit Preview opt-in and exact immutable bindings", async () => {
    const runner = await runnerPromise;
    const parsed = runner.parseRecoveryProbeOptions(environment());
    expect(parsed).toMatchObject({
      mode: "start",
      existingRunId: null,
      environment: "preview",
      binding,
      timeoutMs: 420_000,
      startAckTimeoutMs: 45_000,
      pollIntervalMs: 2_000
    });

    expect(() => runner.parseRecoveryProbeOptions(environment({
      RFP_XRAY_ALLOW_RECOVERY_PROBE: "false"
    }))).toThrowError(expect.objectContaining({ code: "RECOVERY_PROBE_OPT_IN_REQUIRED" }));
    expect(() => runner.parseRecoveryProbeOptions(environment({
      RFP_XRAY_RECOVERY_ENVIRONMENT: "production"
    }))).toThrowError(expect.objectContaining({ code: "RECOVERY_PROBE_PREVIEW_REQUIRED" }));
    expect(() => runner.parseRecoveryProbeOptions(environment({
      RFP_XRAY_RECOVERY_TIMEOUT_MS: "420001"
    }))).toThrowError(expect.objectContaining({ code: "RECOVERY_TIMEOUT_INVALID" }));
    expect(() => runner.parseRecoveryProbeOptions(environment({
      RFP_XRAY_RECOVERY_GIT_COMMIT_SHA: "A".repeat(40)
    }))).toThrowError(expect.objectContaining({ code: "RECOVERY_GIT_COMMIT_SHA_INVALID" }));

    expect(() => runner.parseRecoveryProbeOptions(environment({
      RFP_XRAY_RECOVERY_MODE: "verify-existing",
      RFP_XRAY_RECOVERY_EXISTING_RUN_ID: "wrun_01CanaryRun"
    }))).toThrowError(expect.objectContaining({
      code: "RECOVERY_EXISTING_RUN_OPT_IN_REQUIRED"
    }));
    expect(() => runner.parseRecoveryProbeOptions(environment({
      RFP_XRAY_RECOVERY_MODE: "start",
      RFP_XRAY_RECOVERY_EXISTING_RUN_ID: "wrun_01CanaryRun"
    }))).toThrowError(expect.objectContaining({ code: "RECOVERY_EXISTING_RUN_MODE_REQUIRED" }));
  });

  it("constructs a clean child environment without application/provider secrets", async () => {
    const runner = await runnerPromise;
    const options = runner.parseRecoveryProbeOptions(environment());
    const child = runner.buildCleanChildEnvironment(options, {
      Path: "C:\\Windows\\System32",
      TEMP: "C:\\Temp",
      MONID_API_KEY: "must-not-cross",
      OPENAI_API_KEY: "must-not-cross",
      DATABASE_URL: "must-not-cross",
      BLOB_READ_WRITE_TOKEN: "must-not-cross",
      AWS_SECRET_ACCESS_KEY: "must-not-cross",
      VERCEL_TOKEN: "unselected-token",
      NODE_OPTIONS: "--require=untrusted.js"
    });

    expect(child.Path).toBe("C:\\Windows\\System32");
    expect(child.TEMP).toBe("C:\\Temp");
    expect(child.WORKFLOW_VERCEL_AUTH_TOKEN).toBe(options.token);
    expect(child.VERCEL_DEPLOYMENT_ID).toBe(binding.deploymentId);
    expect(child.VERCEL_ENV).toBe("preview");
    expect(child.RFP_XRAY_VERCEL_TEAM_ID).toBe(binding.teamId);
    expect(child.VERCEL_ORG_ID).toBe(binding.teamId);
    expect(child).not.toHaveProperty("MONID_API_KEY");
    expect(child).not.toHaveProperty("OPENAI_API_KEY");
    expect(child).not.toHaveProperty("DATABASE_URL");
    expect(child).not.toHaveProperty("BLOB_READ_WRITE_TOKEN");
    expect(child).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(child).not.toHaveProperty("VERCEL_TOKEN");
    expect(child).not.toHaveProperty("NODE_OPTIONS");
  });

  it("preflights READY Preview deployment, project, team, and commit without mutation", async () => {
    const runner = await runnerPromise;
    const options = runner.parseRecoveryProbeOptions(environment());
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.startsWith("/v13/deployments/")) {
        return Response.json({
          id: binding.deploymentId,
          readyState: "READY",
          target: null,
          projectId: binding.projectId,
          ownerId: binding.teamId,
          gitSource: { sha: binding.gitCommitSha }
        });
      }
      return Response.json({ id: binding.projectId, accountId: binding.teamId });
    });

    await expect(runner.verifyPreviewDeployment(options, fetcher)).resolves.toMatchObject({
      ready: true,
      environment: "preview",
      git_commit_sha: binding.gitCommitSha
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    }

    const productionFetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const url = new URL(input instanceof Request ? input.url : input.toString());
      return Response.json(url.pathname.startsWith("/v13/deployments/")
        ? {
            uid: binding.deploymentId,
            readyState: "READY",
            target: "production",
            projectId: binding.projectId,
            ownerId: binding.teamId,
            gitSource: { sha: binding.gitCommitSha }
          }
        : { id: binding.projectId, accountId: binding.teamId });
    });
    await expect(runner.verifyPreviewDeployment(options, productionFetcher))
      .rejects.toMatchObject({ code: "VERCEL_DEPLOYMENT_NOT_PREVIEW" });
  });

  it("calls start once and never retries an uncertain acknowledgement", async () => {
    const runner = await runnerPromise;
    let calls = 0;
    const uncertain = async () => {
      calls += 1;
      throw new Error("the queue may have accepted this start");
    };
    await expect(runner.startWorkflowExactlyOnce(uncertain)).rejects.toMatchObject({
      code: "RECOVERY_START_ACK_UNCERTAIN_NO_RETRY"
    });
    expect(calls).toBe(1);

    calls = 0;
    await expect(runner.startWorkflowExactlyOnce(async () => {
      calls += 1;
      return { type: "rfp_xray_recovery_start_ack", runId: "wrun_01CanaryRun" };
    })).resolves.toBe("wrun_01CanaryRun");
    expect(calls).toBe(1);
  });

  it("selects an opted-in existing run without ever evaluating start", async () => {
    const runner = await runnerPromise;
    const existingRunId = "wrun_01ExistingCanaryRun";
    const options = runner.parseRecoveryProbeOptions(environment({
      RFP_XRAY_RECOVERY_MODE: "verify-existing",
      RFP_XRAY_ALLOW_EXISTING_RUN_VERIFICATION: "true",
      RFP_XRAY_RECOVERY_EXISTING_RUN_ID: existingRunId
    }));
    const startAttempt = vi.fn(async () => ({
      type: "rfp_xray_recovery_start_ack",
      runId: "wrun_MustNotStart"
    }));

    await expect(runner.resolveRecoveryProbeRunId(options, startAttempt))
      .resolves.toBe(existingRunId);
    expect(startAttempt).toHaveBeenCalledTimes(0);
  });

  it("requires the exact [1,2] same-step sequence and emits only hashed IDs", async () => {
    const runner = await runnerPromise;
    const runId = "wrun_01CanaryRun";
    const stepId = "step-internal-identifier";
    const events = [
      event(runId, "event-1", "run_created"),
      event(runId, "event-2", "run_started"),
      event(runId, "event-3", "step_created", stepId),
      event(runId, "event-4", "step_started", stepId, 1),
      event(runId, "event-5", "step_started", stepId, 2),
      event(runId, "event-6", "step_completed", stepId),
      event(runId, "event-7", "run_completed")
    ];
    const stepIdSha256 = createHash("sha256").update(stepId).digest("hex");
    const evidence = runner.buildRecoveryEvidence({
      binding,
      run: {
        runId,
        status: "completed",
        deploymentId: binding.deploymentId,
        workflowName: runner.REDELIVERY_PROBE_WORKFLOW_ID
      },
      events,
      steps: [materializedStep(runId, stepId)],
      output: {
        ...binding,
        environment: "preview",
        platform: "linux",
        attempt: 2,
        stepIdSha256,
        completedAt: "2026-09-03T12:00:01.000Z"
      },
      startedAt: new Date("2026-09-03T12:00:00.000Z"),
      finishedAt: new Date("2026-09-03T12:00:02.000Z")
    });

    expect(evidence).toMatchObject({
      observations: {
        run_status: "completed",
        verification_mode: "start",
        attempt_observation: "direct_event_attempts",
        event_step_started_attempts: [1, 2],
        established_attempt_sequence: [1, 2],
        materialized_step_status: "completed",
        materialized_step_attempt: 2,
        output_attempt: 2,
        step_completed_count: 1,
        step_retrying_count: 0,
        step_failed_count: 0,
        third_attempt_count: 0,
        run_completed_count: 1
      },
      provider_calls: { monid: 0, openai: 0, database: 0, blob: 0 },
      costs: {
        provider: {
          cost_classification: "actual",
          actual_micro_usd: 0,
          estimated_micro_usd: null
        },
        vercel: {
          cost_classification: "estimated",
          actual_micro_usd: null
        }
      }
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain(runId);
    expect(serialized).not.toContain(stepId);
    expect(serialized).not.toContain(binding.deploymentId);
    expect(serialized).not.toContain(binding.projectId);
    expect(serialized).not.toContain(binding.teamId);
    expect(serialized).not.toContain("event-1");

    const withRetry = [
      ...events,
      event(runId, "event-8", "step_retrying", stepId)
    ];
    expect(() => runner.buildRecoveryEvidence({
      binding,
      run: {
        runId,
        status: "completed",
        deploymentId: binding.deploymentId,
        workflowName: runner.REDELIVERY_PROBE_WORKFLOW_ID
      },
      events: withRetry,
      steps: [materializedStep(runId, stepId)],
      output: {
        ...binding,
        environment: "preview",
        platform: "linux",
        attempt: 2,
        stepIdSha256,
        completedAt: "2026-09-03T12:00:01.000Z"
      },
      startedAt: new Date("2026-09-03T12:00:00.000Z"),
      finishedAt: new Date("2026-09-03T12:00:02.000Z")
    })).toThrowError(expect.objectContaining({ code: "RECOVERY_EVENT_CARDINALITY_INVALID" }));
  });

  it("derives omitted event attempts only from ordered starts and exact materialized state", async () => {
    const runner = await runnerPromise;
    const runId = "wrun_01ExistingCanaryRun";
    const stepId = "step-existing-internal-identifier";
    const events = [
      event(runId, "event-derived-1", "run_created"),
      event(runId, "event-derived-2", "run_started"),
      event(runId, "event-derived-3", "step_created", stepId),
      event(runId, "event-derived-4", "step_started", stepId, undefined,
        "2026-09-03T12:00:00.100Z"),
      event(runId, "event-derived-5", "step_started", stepId, undefined,
        "2026-09-03T12:00:00.200Z"),
      event(runId, "event-derived-6", "step_completed", stepId),
      event(runId, "event-derived-7", "run_completed")
    ];
    const stepIdSha256 = createHash("sha256").update(stepId).digest("hex");
    const evidence = runner.buildRecoveryEvidence({
      binding,
      run: {
        runId,
        status: "completed",
        deploymentId: binding.deploymentId,
        workflowName: runner.REDELIVERY_PROBE_WORKFLOW_ID
      },
      events,
      steps: [materializedStep(runId, stepId)],
      output: {
        ...binding,
        environment: "preview",
        platform: "linux",
        attempt: 2,
        stepIdSha256,
        completedAt: "2026-09-03T12:00:01.000Z"
      },
      startedAt: new Date("2026-09-03T12:00:00.000Z"),
      finishedAt: new Date("2026-09-03T12:00:02.000Z"),
      mode: "verify-existing"
    });

    expect(evidence).toMatchObject({
      schema_version: "rfp-xray/workflow-redelivery-evidence@2",
      observations: {
        verification_mode: "verify-existing",
        remote_read_only: true,
        workflow_start_count: 0,
        attempt_observation: "derived_platform_omitted_event_attempts",
        event_step_started_attempts: [null, null],
        established_attempt_sequence: [1, 2],
        materialized_step_attempt: 2,
        output_attempt: 2
      },
      assertions: {
        event_attempts_directly_observed: false,
        attempt_sequence_derived_from_materialized_state: true,
        second_attempt_completed: true,
        no_third_attempt: true
      }
    });
  });

  it.each([
    [1, undefined],
    [undefined, 2],
    [1, 3],
    [2, 2],
    [2, 1],
    [1, "2"],
    [1, null]
  ])("rejects mixed or incorrect event attempts %j then %j", async (firstAttempt, secondAttempt) => {
    const runner = await runnerPromise;
    const runId = "wrun_01ExistingCanaryRun";
    const stepId = "step-existing-internal-identifier";
    const stepIdSha256 = createHash("sha256").update(stepId).digest("hex");
    const startedEvent = (eventId: string, attempt: unknown, createdAt: string) => ({
      runId,
      eventId,
      eventType: "step_started",
      correlationId: stepId,
      createdAt: new Date(createdAt),
      eventData: attempt === undefined ? { stepName: "redeliveryProbeStep" } : {
        stepName: "redeliveryProbeStep",
        attempt
      }
    });
    const events = [
      event(runId, "event-invalid-1", "run_created"),
      startedEvent("event-invalid-2", firstAttempt, "2026-09-03T12:00:00.100Z"),
      startedEvent("event-invalid-3", secondAttempt, "2026-09-03T12:00:00.200Z"),
      event(runId, "event-invalid-4", "step_completed", stepId),
      event(runId, "event-invalid-5", "run_completed")
    ];

    expect(() => runner.buildRecoveryEvidence({
      binding,
      run: {
        runId,
        status: "completed",
        deploymentId: binding.deploymentId,
        workflowName: runner.REDELIVERY_PROBE_WORKFLOW_ID
      },
      events,
      steps: [materializedStep(runId, stepId)],
      output: {
        ...binding,
        environment: "preview",
        platform: "linux",
        attempt: 2,
        stepIdSha256,
        completedAt: "2026-09-03T12:00:01.000Z"
      },
      startedAt: new Date("2026-09-03T12:00:00.000Z"),
      finishedAt: new Date("2026-09-03T12:00:02.000Z"),
      mode: "verify-existing"
    })).toThrowError(expect.objectContaining({ code: "RECOVERY_REDELIVERY_SEQUENCE_INVALID" }));
  });

  it("rejects omitted attempts without strict event time order or materialized attempt two", async () => {
    const runner = await runnerPromise;
    const runId = "wrun_01ExistingCanaryRun";
    const stepId = "step-existing-internal-identifier";
    const stepIdSha256 = createHash("sha256").update(stepId).digest("hex");
    const makeInput = (steps: Array<Record<string, unknown>>, secondStartedAt: string) => ({
      binding,
      run: {
        runId,
        status: "completed",
        deploymentId: binding.deploymentId,
        workflowName: runner.REDELIVERY_PROBE_WORKFLOW_ID
      },
      events: [
        event(runId, "event-state-1", "run_created"),
        event(runId, "event-state-2", "step_started", stepId, undefined,
          "2026-09-03T12:00:00.100Z"),
        event(runId, "event-state-3", "step_started", stepId, undefined, secondStartedAt),
        event(runId, "event-state-4", "step_completed", stepId),
        event(runId, "event-state-5", "run_completed")
      ],
      steps,
      output: {
        ...binding,
        environment: "preview",
        platform: "linux",
        attempt: 2,
        stepIdSha256,
        completedAt: "2026-09-03T12:00:01.000Z"
      },
      startedAt: new Date("2026-09-03T12:00:00.000Z"),
      finishedAt: new Date("2026-09-03T12:00:02.000Z"),
      mode: "verify-existing" as const
    });

    expect(() => runner.buildRecoveryEvidence(makeInput(
      [materializedStep(runId, stepId)],
      "2026-09-03T12:00:00.100Z"
    ))).toThrowError(expect.objectContaining({ code: "RECOVERY_REDELIVERY_SEQUENCE_INVALID" }));
    expect(() => runner.buildRecoveryEvidence(makeInput(
      [materializedStep(runId, stepId, { attempt: 1 })],
      "2026-09-03T12:00:00.200Z"
    ))).toThrowError(expect.objectContaining({ code: "RECOVERY_MATERIALIZED_STEP_INVALID" }));
  });

  it("marks every Vercel cost component estimated and keeps provider actual at zero", async () => {
    const runner = await runnerPromise;
    const estimate = runner.estimateVercelProbeCost(7);
    expect(estimate.actual_micro_usd).toBeNull();
    expect(estimate.estimated_micro_usd).toBeGreaterThan(0);
    expect(estimate.components).toHaveLength(5);
    expect(estimate.components.every((component) =>
      component.provider === "vercel" &&
      component.cost_classification === "estimated" &&
      component.actual_micro_usd === null &&
      Number(component.estimated_micro_usd) > 0
    )).toBe(true);
  });

  it("keeps the fault canary out of public application routes and provider imports", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const canaryFiles = [
      "scripts/live-recovery-probe.mjs",
      "src/workflows/redelivery-probe-policy.ts",
      "src/workflows/redelivery-probe-step.ts",
      "src/workflows/redelivery-probe.ts"
    ];
    const importSpecifiers = [];
    for (const relative of canaryFiles) {
      const source = await readFile(path.join(root, relative), "utf8");
      importSpecifiers.push(...[...source.matchAll(
        /(?:from\s+|import\()["']([^"']+)["']/g
      )].map((match) => match[1]));
    }
    expect(importSpecifiers.some((specifier) =>
      /(?:monid|openai|database|drizzle|neon|blob|providers)/i.test(specifier)
    )).toBe(false);

    const appRoot = path.join(root, "src", "app");
    const appEntries = await readdir(appRoot, { recursive: true, withFileTypes: true });
    const publicRouteReferences = [];
    for (const entry of appEntries) {
      if (!entry.isFile() || !/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) continue;
      const source = await readFile(path.join(entry.parentPath, entry.name), "utf8");
      const relativePath = path.relative(appRoot, path.join(entry.parentPath, entry.name));
      const isGeneratedWorkflowControlPlane = relativePath.startsWith(
        path.join(".well-known", "workflow")
      );
      if (source.includes("redelivery-probe") && !isGeneratedWorkflowControlPlane) {
        publicRouteReferences.push(relativePath);
      }
    }
    expect(publicRouteReferences).toEqual([]);
  });
});
