#!/usr/bin/env node

/**
 * Reproduce a sanitized Vercel log receipt for the one historical recovery
 * canary. This program is remote-read-only: it lists completed Workflow runs,
 * performs GET-only deployment checks, reads bounded logs, and inspects a Git
 * object. It never starts, retries, cancels, or mutates a Workflow run.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_DIRECTORY = path.join(REPOSITORY_ROOT, ".data", "release-evidence");
const VERCEL_API_ORIGIN = "https://api.vercel.com";
const VERCEL_CLI_VERSION = "59.11.2";
const LOG_LIMIT = 100;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const MAX_WINDOW_MS = 30 * 60_000;
const READ_TIMEOUT_MS = 45_000;
export const REDELIVERY_PROBE_WORKFLOW_ID =
  "workflow//./src/workflows/redelivery-probe//redeliveryProbeWorkflow";
export const REDELIVERY_PROBE_SOURCE_PATH = "src/workflows/redelivery-probe-step.ts";

const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const PROJECT_ID = /^prj_[A-Za-z0-9]+$/;
const TEAM_ID = /^(?:team|user)_[A-Za-z0-9]+$/;
const PROJECT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const SCOPE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,98}[A-Za-z0-9])?$/;
const SYSTEM_ENV_ALLOWLIST = new Set([
  "appdata",
  "comspec",
  "lang",
  "lc_all",
  "localappdata",
  "path",
  "pathext",
  "systemroot",
  "temp",
  "tmp",
  "tmpdir",
  "tz",
  "userprofile",
  "windir"
]);

export class SigkillReceiptError extends Error {
  constructor(code, stage) {
    super(code);
    this.name = "SigkillReceiptError";
    this.code = code;
    this.stage = stage;
  }
}

function fail(code, stage) {
  throw new SigkillReceiptError(code, stage);
}

function requiredString(environment, name, pattern, code) {
  const value = environment[name];
  if (typeof value !== "string" || !pattern.test(value)) fail(code, "configuration");
  return value;
}

function canonicalTimestamp(environment, name, code) {
  const value = environment[name];
  if (typeof value !== "string") fail(code, "configuration");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(code, "configuration");
  }
  return value;
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Nullable(value) {
  return typeof value === "string" && value.length > 0 ? sha256Text(value) : null;
}

function asRecord(value, code, stage) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, stage);
  return value;
}

export function parseSigkillReceiptOptions(environment = process.env) {
  if (environment.RFP_XRAY_ALLOW_SIGKILL_LOG_RECEIPT !== "true") {
    fail("SIGKILL_RECEIPT_OPT_IN_REQUIRED", "configuration");
  }
  if (environment.RFP_XRAY_SIGKILL_ENVIRONMENT !== "preview") {
    fail("SIGKILL_RECEIPT_PREVIEW_REQUIRED", "configuration");
  }
  if (environment.RFP_XRAY_SIGKILL_WORKFLOW_NAME !== REDELIVERY_PROBE_WORKFLOW_ID) {
    fail("SIGKILL_RECEIPT_WORKFLOW_MISMATCH", "configuration");
  }
  const token = environment.WORKFLOW_VERCEL_AUTH_TOKEN || environment.VERCEL_TOKEN;
  if (
    typeof token !== "string" || token.length < 8 || token.length > 4096 ||
    token.trim() !== token || /[\r\n]/.test(token)
  ) {
    fail("VERCEL_AUTH_TOKEN_REQUIRED", "configuration");
  }

  const since = canonicalTimestamp(environment, "RFP_XRAY_SIGKILL_SINCE", "SIGKILL_SINCE_INVALID");
  const until = canonicalTimestamp(environment, "RFP_XRAY_SIGKILL_UNTIL", "SIGKILL_UNTIL_INVALID");
  const duration = Date.parse(until) - Date.parse(since);
  if (duration <= 0 || duration > MAX_WINDOW_MS) {
    fail("SIGKILL_WINDOW_INVALID", "configuration");
  }

  return {
    token,
    environment: "preview",
    since,
    until,
    binding: {
      deploymentId: requiredString(
        environment,
        "RFP_XRAY_SIGKILL_DEPLOYMENT_ID",
        DEPLOYMENT_ID,
        "SIGKILL_DEPLOYMENT_ID_INVALID"
      ),
      gitCommitSha: requiredString(
        environment,
        "RFP_XRAY_SIGKILL_GIT_COMMIT_SHA",
        GIT_SHA,
        "SIGKILL_GIT_COMMIT_SHA_INVALID"
      ),
      projectId: requiredString(
        environment,
        "RFP_XRAY_SIGKILL_PROJECT_ID",
        PROJECT_ID,
        "SIGKILL_PROJECT_ID_INVALID"
      ),
      projectName: requiredString(
        environment,
        "RFP_XRAY_SIGKILL_PROJECT_NAME",
        PROJECT_NAME,
        "SIGKILL_PROJECT_NAME_INVALID"
      ),
      teamId: requiredString(
        environment,
        "RFP_XRAY_SIGKILL_TEAM_ID",
        TEAM_ID,
        "SIGKILL_TEAM_ID_INVALID"
      ),
      scope: requiredString(
        environment,
        "RFP_XRAY_SIGKILL_SCOPE",
        SCOPE,
        "SIGKILL_SCOPE_INVALID"
      ),
      workflowName: REDELIVERY_PROBE_WORKFLOW_ID
    }
  };
}

function candidateString(record, paths) {
  for (const parts of paths) {
    let value = record;
    for (const part of parts) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        value = undefined;
        break;
      }
      value = value[part];
    }
    if (typeof value === "string") return value;
  }
  return null;
}

async function fetchVercelJson(url, token, fetcher) {
  if (url.origin !== VERCEL_API_ORIGIN || url.username || url.password) {
    fail("VERCEL_PREFLIGHT_URL_REJECTED", "preview_preflight");
  }
  let response;
  try {
    response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(20_000)
    });
  } catch {
    fail("VERCEL_PREFLIGHT_REQUEST_FAILED", "preview_preflight");
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    fail("VERCEL_PREFLIGHT_REDIRECT_REJECTED", "preview_preflight");
  }
  if (!response.ok) {
    await response.body?.cancel();
    fail("VERCEL_PREFLIGHT_HTTP_REJECTED", "preview_preflight");
  }
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 1_000_000) {
    await response.body?.cancel();
    fail("VERCEL_PREFLIGHT_RESPONSE_TOO_LARGE", "preview_preflight");
  }
  try {
    return asRecord(await response.json(), "VERCEL_PREFLIGHT_RESPONSE_INVALID", "preview_preflight");
  } catch (error) {
    if (error instanceof SigkillReceiptError) throw error;
    fail("VERCEL_PREFLIGHT_RESPONSE_INVALID", "preview_preflight");
  }
}

/** GET-only proof that all immutable Preview deployment bindings are exact. */
export async function verifyPreviewDeployment(options, fetcher = fetch) {
  const teamQuery = encodeURIComponent(options.binding.teamId);
  const deploymentUrl = new URL(
    `/v13/deployments/${encodeURIComponent(options.binding.deploymentId)}?teamId=${teamQuery}`,
    VERCEL_API_ORIGIN
  );
  const projectUrl = new URL(
    `/v9/projects/${encodeURIComponent(options.binding.projectId)}?teamId=${teamQuery}`,
    VERCEL_API_ORIGIN
  );
  const [deployment, project] = await Promise.all([
    fetchVercelJson(deploymentUrl, options.token, fetcher),
    fetchVercelJson(projectUrl, options.token, fetcher)
  ]);

  const deploymentId = candidateString(deployment, [["uid"], ["id"]]);
  if (deploymentId !== options.binding.deploymentId || deployment.readyState !== "READY") {
    fail("VERCEL_DEPLOYMENT_NOT_READY_OR_MISMATCHED", "preview_preflight");
  }
  const deploymentProjectId = candidateString(deployment, [["projectId"], ["project", "id"]]);
  if (
    deploymentProjectId !== options.binding.projectId ||
    project.id !== options.binding.projectId ||
    project.name !== options.binding.projectName
  ) {
    fail("VERCEL_PROJECT_MISMATCH", "preview_preflight");
  }
  const projectTeamId = candidateString(project, [["accountId"], ["teamId"], ["team", "id"]]);
  const deploymentTeamId = candidateString(deployment, [["ownerId"], ["teamId"], ["team", "id"]]);
  if (projectTeamId !== options.binding.teamId || deploymentTeamId !== options.binding.teamId) {
    fail("VERCEL_TEAM_MISMATCH", "preview_preflight");
  }
  const target = deployment.target;
  const environment = candidateString(deployment, [
    ["environment"],
    ["meta", "vercelTargetEnvironment"],
    ["meta", "target"]
  ]);
  const isPreview = deployment.customEnvironment == null &&
    (target === null || target === "preview" || (target === undefined && environment === "preview"));
  if (!isPreview || target === "production" || environment === "production") {
    fail("VERCEL_DEPLOYMENT_NOT_PREVIEW", "preview_preflight");
  }
  const gitSha = candidateString(deployment, [
    ["gitSource", "sha"],
    ["meta", "githubCommitSha"],
    ["meta", "gitCommitSha"]
  ]);
  if (gitSha?.toLowerCase() !== options.binding.gitCommitSha) {
    fail("VERCEL_GIT_SHA_MISMATCH", "preview_preflight");
  }
  return true;
}

export function buildCleanChildEnvironment(token, inherited = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (typeof value === "string" && SYSTEM_ENV_ALLOWLIST.has(key.toLowerCase())) {
      environment[key] = value;
    }
  }
  const clean = {
    ...environment,
    CI: "1",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    VERCEL_TELEMETRY_DISABLED: "1"
  };
  if (typeof token === "string") clean.VERCEL_TOKEN = token;
  return clean;
}

export function buildVercelLogArguments(options) {
  return [
    "logs",
    "--deployment", options.binding.deploymentId,
    "--project", options.binding.projectName,
    "--environment", "preview",
    "--source", "serverless",
    "--since", options.since,
    "--until", options.until,
    "--limit", String(LOG_LIMIT),
    "--query", "SIGKILL",
    "--expand",
    "--json",
    "--scope", options.binding.scope,
    "--non-interactive",
    "--no-color"
  ];
}

export function buildGitShowArguments(options) {
  return ["show", `${options.binding.gitCommitSha}:${REDELIVERY_PROBE_SOURCE_PATH}`];
}

export function captureCommand(
  command,
  arguments_,
  environment,
  spawner = spawn,
  timeoutMs = READ_TIMEOUT_MS
) {
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    try {
      child = spawner(command, arguments_, {
        cwd: REPOSITORY_ROOT,
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch {
      reject(new SigkillReceiptError("READ_ONLY_COMMAND_START_FAILED", "command_capture"));
      return;
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill();
      finish(() => reject(
        new SigkillReceiptError("READ_ONLY_COMMAND_TIMEOUT", "command_capture")
      ));
    }, timeoutMs);
    const collect = (target, chunk, isStdout) => {
      const buffer = Buffer.from(chunk);
      if (isStdout) stdoutBytes += buffer.length;
      else stderrBytes += buffer.length;
      if (stdoutBytes > MAX_CAPTURE_BYTES || stderrBytes > MAX_CAPTURE_BYTES) {
        overflow = true;
        child.kill();
        return;
      }
      target.push(buffer);
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk, true));
    child.stderr.on("data", (chunk) => collect(stderr, chunk, false));
    child.once("error", () => finish(() => reject(
      new SigkillReceiptError("READ_ONLY_COMMAND_FAILED", "command_capture")
    )));
    child.once("close", (code) => {
      if (overflow) {
        finish(() => reject(
          new SigkillReceiptError("READ_ONLY_COMMAND_OUTPUT_TOO_LARGE", "command_capture")
        ));
        return;
      }
      if (code !== 0) {
        finish(() => reject(
          new SigkillReceiptError("READ_ONLY_COMMAND_FAILED", "command_capture")
        ));
        return;
      }
      finish(() => resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
    });
  });
}

async function withReadTimeout(promise, timeoutMs, code, stage) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new SigkillReceiptError(code, stage)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyPinnedVercelCli() {
  const require = createRequire(import.meta.url);
  const installedPackagePath = require.resolve("vercel/package.json");
  const [rootPackage, installedPackage] = await Promise.all([
    readFile(path.join(REPOSITORY_ROOT, "package.json"), "utf8").then(JSON.parse),
    readFile(installedPackagePath, "utf8").then(JSON.parse)
  ]);
  if (
    rootPackage.devDependencies?.vercel !== VERCEL_CLI_VERSION ||
    installedPackage.version !== VERCEL_CLI_VERSION
  ) {
    fail("VERCEL_CLI_VERSION_MISMATCH", "cli_preflight");
  }
  return path.join(path.dirname(installedPackagePath), "dist", "vc.js");
}

function dateMilliseconds(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") return Date.parse(value);
  return Number.NaN;
}

/** Select one completed run without ever calling a Workflow mutation API. */
export async function findExactHistoricalRun(world, options, timeoutMs = READ_TIMEOUT_MS) {
  const response = await withReadTimeout(
    world.runs.list({
      workflowName: options.binding.workflowName,
      status: "completed",
      resolveData: "none",
      pagination: { limit: LOG_LIMIT, sortOrder: "desc" }
    }),
    timeoutMs,
    "WORKFLOW_RUN_LIST_TIMEOUT",
    "workflow_read"
  );
  if (!response || !Array.isArray(response.data)) {
    fail("WORKFLOW_RUN_LIST_INVALID", "workflow_read");
  }
  if (response.hasMore === true || response.cursor != null || response.data.length >= LOG_LIMIT) {
    fail("WORKFLOW_RUN_LIST_AMBIGUOUS", "workflow_read");
  }
  const sinceMs = Date.parse(options.since);
  const untilMs = Date.parse(options.until);
  const candidates = response.data.filter((run) => {
    const observedAt = dateMilliseconds(run.startedAt ?? run.createdAt);
    return run.status === "completed" &&
      run.deploymentId === options.binding.deploymentId &&
      run.workflowName === options.binding.workflowName &&
      Number.isFinite(observedAt) && observedAt >= sinceMs && observedAt <= untilMs;
  });
  if (candidates.length !== 1 || typeof candidates[0].runId !== "string") {
    fail("WORKFLOW_RUN_CARDINALITY_INVALID", "workflow_read");
  }
  return candidates[0];
}

function hasTruncationFlag(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasTruncationFlag);
  return Object.entries(value).some(([key, nested]) =>
    (/truncat/i.test(key) && nested !== false && nested != null && nested !== 0 && nested !== "") ||
    hasTruncationFlag(nested)
  );
}

function literalOccurrences(value, literal) {
  if (typeof value !== "string") return 0;
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(literal, offset)) !== -1) {
    count += 1;
    offset += literal.length;
  }
  return count;
}

export function parseJsonLines(buffer) {
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 1 || lines.length >= LOG_LIMIT) {
    fail("VERCEL_LOG_ROW_CARDINALITY_INVALID", "log_validation");
  }
  try {
    return lines.map((line) => asRecord(JSON.parse(line), "VERCEL_LOG_JSON_INVALID", "log_validation"));
  } catch (error) {
    if (error instanceof SigkillReceiptError) throw error;
    fail("VERCEL_LOG_JSON_INVALID", "log_validation");
  }
}

/** Validate raw rows in memory and return only safe, hashed observations. */
export function validateLogRows(rows, options, rawRunId) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length >= LOG_LIMIT) {
    fail("VERCEL_LOG_ROW_CARDINALITY_INVALID", "log_validation");
  }
  const sinceMs = Date.parse(options.since);
  const untilMs = Date.parse(options.until);
  let nestedSigkillCount = 0;
  let sigkillRowContainsRunId = false;
  const safeRows = [];
  for (const rowValue of rows) {
    const row = asRecord(rowValue, "VERCEL_LOG_ROW_INVALID", "log_validation");
    if (
      row.deploymentId !== options.binding.deploymentId ||
      row.projectId !== options.binding.projectId ||
      row.environment !== "preview" ||
      row.source !== "serverless"
    ) {
      fail("VERCEL_LOG_BINDING_MISMATCH", "log_validation");
    }
    const timestamp = dateMilliseconds(row.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < sinceMs || timestamp > untilMs) {
      fail("VERCEL_LOG_WINDOW_MISMATCH", "log_validation");
    }
    if (hasTruncationFlag(row)) fail("VERCEL_LOG_TRUNCATED", "log_validation");
    if (!Array.isArray(row.logs)) fail("VERCEL_NESTED_LOGS_INVALID", "log_validation");
    const nestedMessages = row.logs.map((entry) => {
      const nested = asRecord(entry, "VERCEL_NESTED_LOGS_INVALID", "log_validation");
      return typeof nested.message === "string" ? nested.message : null;
    });
    const rowSigkillCount = nestedMessages.reduce(
      (count, message) => count + literalOccurrences(message, "SIGKILL"),
      0
    );
    nestedSigkillCount += rowSigkillCount;
    const correlationFields = [
      row.id,
      row.traceId,
      row.requestPath,
      row.message,
      ...nestedMessages
    ];
    if (
      rowSigkillCount > 0 &&
      correlationFields.some((value) => typeof value === "string" && value.includes(rawRunId))
    ) {
      sigkillRowContainsRunId = true;
    }
    safeRows.push({
      request_id_sha256: sha256Nullable(row.id),
      trace_id_sha256: sha256Nullable(row.traceId),
      request_path_sha256: sha256Nullable(row.requestPath),
      message_sha256: sha256Nullable(row.message),
      nested_message_sha256: nestedMessages.map(sha256Nullable),
      response_status_code: Number.isInteger(row.responseStatusCode)
        ? row.responseStatusCode
        : null
    });
  }
  if (nestedSigkillCount !== 1) {
    fail("VERCEL_SIGKILL_CARDINALITY_INVALID", "log_validation");
  }
  const exactRunBinding = sigkillRowContainsRunId;
  return {
    nestedSigkillCount,
    exactRunBinding,
    corroborationKind: exactRunBinding
      ? "exact_run_log_corroboration"
      : "deployment_bounded_window_corroboration_only",
    safeRows
  };
}

export function inspectDeployedSource(sourceBuffer) {
  const source = sourceBuffer.toString("utf8");
  const matches = source.match(
    /process\.kill\s*\(\s*process\.pid\s*,\s*["']SIGKILL["']\s*\)/g
  ) || [];
  if (matches.length !== 1) {
    fail("DEPLOYED_SIGKILL_CALLSITE_CARDINALITY_INVALID", "source_validation");
  }
  return {
    sha256: sha256Text(sourceBuffer),
    bytes: sourceBuffer.length,
    sigkillCallCount: matches.length
  };
}

export function buildSanitizedReceipt({ options, run, logCapture, validatedLogs, sourceInspection }) {
  const runIdHash = sha256Text(run.runId);
  return {
    schema_version: "rfp-xray/vercel-sigkill-log-receipt@2",
    generated_at: new Date().toISOString(),
    scope: {
      environment: "preview",
      source: "serverless",
      deployment_id_sha256: sha256Text(options.binding.deploymentId),
      project_id_sha256: sha256Text(options.binding.projectId),
      project_name_sha256: sha256Text(options.binding.projectName),
      team_id_sha256: sha256Text(options.binding.teamId),
      scope_sha256: sha256Text(options.binding.scope),
      run_id_sha256: runIdHash,
      git_commit_sha: options.binding.gitCommitSha,
      workflow_name: options.binding.workflowName
    },
    query: {
      since: options.since,
      until: options.until,
      limit: LOG_LIMIT,
      literal_query: "SIGKILL",
      returned_row_count: validatedLogs.safeRows.length
    },
    observations: {
      corroboration_kind: validatedLogs.corroborationKind,
      exact_run_binding: validatedLogs.exactRunBinding,
      nested_literal_sigkill_match_count: validatedLogs.nestedSigkillCount,
      rows: validatedLogs.safeRows,
      raw_stdout_sha256: sha256Text(logCapture.stdout),
      raw_stdout_bytes: logCapture.stdout.length,
      raw_stderr_sha256: sha256Text(logCapture.stderr),
      raw_stderr_bytes: logCapture.stderr.length,
      vercel_cli_version: VERCEL_CLI_VERSION,
      deployed_source_sha256: sourceInspection.sha256,
      deployed_source_bytes: sourceInspection.bytes,
      deployed_source_sigkill_call_count: sourceInspection.sigkillCallCount
    },
    assertions: {
      remote_read_only: true,
      workflow_start_count: 0,
      exact_preview_deployment_binding: true,
      bounded_deployment_window_corroboration: true,
      exact_run_binding: validatedLogs.exactRunBinding,
      exactly_one_nested_literal_sigkill_log: true,
      exactly_one_deployed_sigkill_callsite: true,
      raw_log_content_not_persisted: true
    }
  };
}

async function writeReceipt(receipt) {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const timestamp = receipt.generated_at.replace(/[:.]/g, "-");
  const suffix = receipt.scope.run_id_sha256.slice(0, 12);
  const receiptPath = path.join(
    EVIDENCE_DIRECTORY,
    `vercel-sigkill-log-receipt-${timestamp}-${suffix}.json`
  );
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  return receiptPath;
}

export async function runSigkillReceipt(environment = process.env) {
  const options = parseSigkillReceiptOptions(environment);
  await verifyPreviewDeployment(options);
  const cliPath = await verifyPinnedVercelCli();
  const { createVercelWorld } = await import("@workflow/world-vercel");
  const world = createVercelWorld({
    token: options.token,
    projectConfig: {
      projectId: options.binding.projectId,
      teamId: options.binding.teamId,
      environment: "preview"
    }
  });
  const run = await findExactHistoricalRun(world, options);
  const cleanEnvironment = buildCleanChildEnvironment(options.token, environment);
  const cleanGitEnvironment = buildCleanChildEnvironment(null, environment);
  const [logCapture, sourceCapture] = await Promise.all([
    captureCommand(
      process.execPath,
      [cliPath, ...buildVercelLogArguments(options)],
      cleanEnvironment
    ),
    captureCommand("git", buildGitShowArguments(options), cleanGitEnvironment)
  ]);
  const rows = parseJsonLines(logCapture.stdout);
  const validatedLogs = validateLogRows(rows, options, run.runId);
  const sourceInspection = inspectDeployedSource(sourceCapture.stdout);
  const receipt = buildSanitizedReceipt({
    options,
    run,
    logCapture,
    validatedLogs,
    sourceInspection
  });
  const receiptPath = await writeReceipt(receipt);
  return { receipt, receiptPath };
}

async function main() {
  try {
    const result = await runSigkillReceipt();
    process.stdout.write(`${JSON.stringify({
      ok: true,
      receipt_path: path.relative(REPOSITORY_ROOT, result.receiptPath),
      run_id_sha256: result.receipt.scope.run_id_sha256,
      corroboration_kind: result.receipt.observations.corroboration_kind,
      exact_run_binding: result.receipt.observations.exact_run_binding,
      workflow_start_count: 0
    })}\n`);
  } catch (error) {
    const code = error instanceof SigkillReceiptError ? error.code : "SIGKILL_RECEIPT_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
