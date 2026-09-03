import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const runnerPromise = import(
  new URL("../../scripts/vercel-sigkill-log-receipt.mjs", import.meta.url).href
);

const binding = {
  deploymentId: "dpl_ExactPreview123",
  gitCommitSha: "d5dc60a0331cd41b37f8f9ef7024c528f828b43e",
  projectId: "prj_ExactProject123",
  projectName: "project-name-sentinel",
  teamId: "team_ExactTeam123",
  scope: "chendavs-projects",
  workflowName: "workflow//./src/workflows/redelivery-probe//redeliveryProbeWorkflow"
};

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    RFP_XRAY_ALLOW_SIGKILL_LOG_RECEIPT: "true",
    RFP_XRAY_SIGKILL_ENVIRONMENT: "preview",
    RFP_XRAY_SIGKILL_DEPLOYMENT_ID: binding.deploymentId,
    RFP_XRAY_SIGKILL_GIT_COMMIT_SHA: binding.gitCommitSha,
    RFP_XRAY_SIGKILL_PROJECT_ID: binding.projectId,
    RFP_XRAY_SIGKILL_PROJECT_NAME: binding.projectName,
    RFP_XRAY_SIGKILL_TEAM_ID: binding.teamId,
    RFP_XRAY_SIGKILL_SCOPE: binding.scope,
    RFP_XRAY_SIGKILL_WORKFLOW_NAME: binding.workflowName,
    RFP_XRAY_SIGKILL_SINCE: "2026-09-03T20:32:19.316Z",
    RFP_XRAY_SIGKILL_UNTIL: "2026-09-03T20:34:23.226Z",
    VERCEL_TOKEN: "vercel-token-sentinel",
    ...overrides
  };
}

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    deploymentId: binding.deploymentId,
    projectId: binding.projectId,
    environment: "preview",
    source: "serverless",
    timestamp: Date.parse("2026-09-03T20:33:00.000Z"),
    id: "request-id-sentinel",
    traceId: undefined,
    requestPath: "/workflow/internal/path-sentinel",
    message: "serverless invocation completed",
    responseStatusCode: 200,
    logs: [{ level: "error", message: "process terminated by SIGKILL sentinel-message" }],
    ...overrides
  };
}

describe("read-only Vercel SIGKILL log receipt", () => {
  it("requires explicit Preview opt-in and a canonical <=30 minute window", async () => {
    const runner = await runnerPromise;
    expect(runner.parseSigkillReceiptOptions(environment())).toMatchObject({
      environment: "preview",
      since: "2026-09-03T20:32:19.316Z",
      until: "2026-09-03T20:34:23.226Z",
      binding
    });
    expect(() => runner.parseSigkillReceiptOptions(environment({
      RFP_XRAY_ALLOW_SIGKILL_LOG_RECEIPT: undefined
    }))).toThrowError(expect.objectContaining({ code: "SIGKILL_RECEIPT_OPT_IN_REQUIRED" }));
    expect(() => runner.parseSigkillReceiptOptions(environment({
      RFP_XRAY_SIGKILL_ENVIRONMENT: "production"
    }))).toThrowError(expect.objectContaining({ code: "SIGKILL_RECEIPT_PREVIEW_REQUIRED" }));
    expect(() => runner.parseSigkillReceiptOptions(environment({
      RFP_XRAY_SIGKILL_SINCE: "2026-09-03T20:32:19Z"
    }))).toThrowError(expect.objectContaining({ code: "SIGKILL_SINCE_INVALID" }));
    expect(() => runner.parseSigkillReceiptOptions(environment({
      RFP_XRAY_SIGKILL_UNTIL: "2026-09-03T21:33:00.000Z"
    }))).toThrowError(expect.objectContaining({ code: "SIGKILL_WINDOW_INVALID" }));
  });

  it("builds exact log arguments without putting the token on the command line", async () => {
    const runner = await runnerPromise;
    const options = runner.parseSigkillReceiptOptions(environment());
    const arguments_ = runner.buildVercelLogArguments(options);
    expect(arguments_).toEqual([
      "logs",
      "--deployment", binding.deploymentId,
      "--project", binding.projectName,
      "--environment", "preview",
      "--source", "serverless",
      "--since", options.since,
      "--until", options.until,
      "--limit", "100",
      "--query", "SIGKILL",
      "--expand",
      "--json",
      "--scope", binding.scope,
      "--non-interactive",
      "--no-color"
    ]);
    expect(arguments_.join(" ")).not.toContain(options.token);
    expect(runner.buildGitShowArguments(options)).toEqual([
      "show",
      `${binding.gitCommitSha}:src/workflows/redelivery-probe-step.ts`
    ]);
  });

  it("passes only allowlisted system values and VERCEL_TOKEN to child processes", async () => {
    const runner = await runnerPromise;
    const child = runner.buildCleanChildEnvironment("exact-token", {
      Path: "C:\\Windows\\System32",
      TEMP: "C:\\Temp",
      MONID_API_KEY: "must-not-cross",
      OPENAI_API_KEY: "must-not-cross",
      DATABASE_URL: "must-not-cross",
      BLOB_READ_WRITE_TOKEN: "must-not-cross",
      NODE_OPTIONS: "--require=untrusted.js",
      VERCEL_TOKEN: "old-token"
    });
    expect(child).toMatchObject({
      Path: "C:\\Windows\\System32",
      TEMP: "C:\\Temp",
      VERCEL_TOKEN: "exact-token",
      CI: "1",
      NO_COLOR: "1"
    });
    expect(child).not.toHaveProperty("MONID_API_KEY");
    expect(child).not.toHaveProperty("OPENAI_API_KEY");
    expect(child).not.toHaveProperty("DATABASE_URL");
    expect(child).not.toHaveProperty("BLOB_READ_WRITE_TOKEN");
    expect(child).not.toHaveProperty("NODE_OPTIONS");
    const gitChild = runner.buildCleanChildEnvironment(null, {
      Path: "C:\\Windows\\System32",
      VERCEL_TOKEN: "must-not-cross"
    });
    expect(gitChild).not.toHaveProperty("VERCEL_TOKEN");
  });

  it("preflights exact READY Preview deployment, project name, team, and Git SHA with GET", async () => {
    const runner = await runnerPromise;
    const options = runner.parseSigkillReceiptOptions(environment());
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(init?.method).toBe("GET");
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
      return Response.json({
        id: binding.projectId,
        name: binding.projectName,
        accountId: binding.teamId
      });
    });
    await expect(runner.verifyPreviewDeployment(options, fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);

    const wrongNameFetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      return Response.json(url.pathname.startsWith("/v13/deployments/") ? {
        id: binding.deploymentId,
        readyState: "READY",
        target: null,
        projectId: binding.projectId,
        ownerId: binding.teamId,
        gitSource: { sha: binding.gitCommitSha }
      } : { id: binding.projectId, name: "wrong-project", accountId: binding.teamId });
    });
    await expect(runner.verifyPreviewDeployment(options, wrongNameFetcher))
      .rejects.toMatchObject({ code: "VERCEL_PROJECT_MISMATCH" });
  });

  it("selects exactly one completed run in the bounded deployment window", async () => {
    const runner = await runnerPromise;
    const options = runner.parseSigkillReceiptOptions(environment());
    const exactRun = {
      runId: "wrun_ExactHistoricalRun",
      status: "completed",
      deploymentId: binding.deploymentId,
      workflowName: binding.workflowName,
      createdAt: new Date("2026-09-03T20:32:30.000Z")
    };
    const world = {
      runs: {
        list: vi.fn(async () => ({ data: [exactRun], hasMore: false }))
      }
    };
    await expect(runner.findExactHistoricalRun(world, options)).resolves.toBe(exactRun);
    expect(world.runs.list).toHaveBeenCalledWith({
      workflowName: binding.workflowName,
      status: "completed",
      resolveData: "none",
      pagination: { limit: 100, sortOrder: "desc" }
    });

    for (const response of [
      { data: [exactRun], hasMore: true },
      { data: [exactRun], hasMore: false, cursor: "cursor" },
      { data: [exactRun, { ...exactRun, runId: "wrun_Second" }], hasMore: false }
    ]) {
      await expect(runner.findExactHistoricalRun({
        runs: { list: async () => response }
      }, options)).rejects.toBeInstanceOf(runner.SigkillReceiptError);
    }

    await expect(runner.findExactHistoricalRun({
      runs: { list: () => new Promise(() => undefined) }
    }, options, 5)).rejects.toMatchObject({ code: "WORKFLOW_RUN_LIST_TIMEOUT" });
  });

  it("keeps absent fields null and does not upgrade bounded evidence into exact run binding", async () => {
    const runner = await runnerPromise;
    const options = runner.parseSigkillReceiptOptions(environment());
    const result = runner.validateLogRows([logRow()], options, "wrun_NotPresentInLog");
    expect(result).toMatchObject({
      nestedSigkillCount: 1,
      exactRunBinding: false,
      corroborationKind: "deployment_bounded_window_corroboration_only",
      safeRows: [{ trace_id_sha256: null, response_status_code: 200 }]
    });
    expect(result.safeRows[0].trace_id_sha256).not.toBe(
      createHash("sha256").update("undefined").digest("hex")
    );

    const exact = runner.validateLogRows([
      logRow({ requestPath: "/api/workflow/wrun_ExactHistoricalRun" })
    ], options, "wrun_ExactHistoricalRun");
    expect(exact).toMatchObject({
      exactRunBinding: true,
      corroborationKind: "exact_run_log_corroboration"
    });

    const crossRow = runner.validateLogRows([
      logRow({ id: "sigkill-row", requestPath: "/unrelated" }),
      logRow({
        id: "target-run-row",
        requestPath: "/api/workflow/wrun_ExactHistoricalRun",
        logs: [{ message: "ordinary completion" }]
      })
    ], options, "wrun_ExactHistoricalRun");
    expect(crossRow).toMatchObject({
      nestedSigkillCount: 1,
      exactRunBinding: false,
      corroborationKind: "deployment_bounded_window_corroboration_only"
    });
  });

  it("kills a hung read-only child and fails closed on its hard timeout", async () => {
    const runner = await runnerPromise;
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    const spawner = vi.fn(() => child);
    await expect(runner.captureCommand(
      "read-only-command",
      ["safe-argument"],
      {},
      spawner,
      5
    )).rejects.toMatchObject({ code: "READ_ONLY_COMMAND_TIMEOUT" });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("fails closed on binding, window, truncation, and SIGKILL cardinality defects", async () => {
    const runner = await runnerPromise;
    const options = runner.parseSigkillReceiptOptions(environment());
    const cases = [
      [logRow({ deploymentId: "dpl_Wrong" })],
      [logRow({ projectId: "prj_Wrong" })],
      [logRow({ timestamp: Date.parse("2026-09-03T21:33:00.000Z") })],
      [logRow({ truncated: true })],
      [logRow({ logs: [{ message: "ordinary exit" }] })],
      [logRow({ logs: [{ message: "SIGKILL then SIGKILL" }] })],
      [logRow(), logRow({ id: "second-row" })]
    ];
    for (const rows of cases) {
      expect(() => runner.validateLogRows(rows, options, "wrun_ExactHistoricalRun"))
        .toThrowError(runner.SigkillReceiptError);
    }
  });

  it("requires exactly one deployed process.kill SIGKILL callsite", async () => {
    const runner = await runnerPromise;
    expect(runner.inspectDeployedSource(Buffer.from(
      "export function x() { process.kill(process.pid, \"SIGKILL\"); }"
    ))).toMatchObject({ sigkillCallCount: 1 });
    expect(() => runner.inspectDeployedSource(Buffer.from("export function x() {}")))
      .toThrowError(expect.objectContaining({
        code: "DEPLOYED_SIGKILL_CALLSITE_CARDINALITY_INVALID"
      }));
  });

  it("serializes only hashes and an explicit bounded-corroboration truth boundary", async () => {
    const runner = await runnerPromise;
    const options = runner.parseSigkillReceiptOptions(environment());
    const rawRunId = "wrun_RawRunSentinel";
    const validatedLogs = runner.validateLogRows([logRow()], options, rawRunId);
    const receipt = runner.buildSanitizedReceipt({
      options,
      run: { runId: rawRunId },
      logCapture: {
        stdout: Buffer.from("raw-stdout-stream-sentinel"),
        stderr: Buffer.from("raw-stderr-stream-sentinel")
      },
      validatedLogs,
      sourceInspection: {
        sha256: "a".repeat(64),
        bytes: 42,
        sigkillCallCount: 1
      }
    });
    expect(receipt).toMatchObject({
      observations: {
        corroboration_kind: "deployment_bounded_window_corroboration_only",
        exact_run_binding: false
      },
      assertions: {
        remote_read_only: true,
        workflow_start_count: 0,
        exact_run_binding: false
      }
    });
    const serialized = JSON.stringify(receipt);
    for (const sentinel of [
      rawRunId,
      binding.deploymentId,
      binding.projectId,
      binding.projectName,
      binding.teamId,
      binding.scope,
      "request-id-sentinel",
      "/workflow/internal/path-sentinel",
      "sentinel-message",
      "raw-stdout-stream-sentinel",
      "raw-stderr-stream-sentinel",
      options.token
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it("contains no Workflow mutation import or operation", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const source = await readFile(
      path.join(root, "scripts", "vercel-sigkill-log-receipt.mjs"),
      "utf8"
    );
    expect(source).not.toMatch(/from\s+["']workflow\/api["']/);
    expect(source).not.toMatch(/import\(["']workflow\/api["']\)/);
    expect(source).not.toMatch(/\.start\s*\(/);
    expect(source).not.toMatch(/events\.create\s*\(/);
    expect(source).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(source).toContain("world.runs.list");
    expect(source).toContain('method: "GET"');
  });
});
