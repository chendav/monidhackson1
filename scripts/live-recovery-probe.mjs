#!/usr/bin/env node

/**
 * Provider-free Vercel Workflow hard-kill/redelivery probe.
 *
 * Safety contract:
 * - the only mutation is one start() against an exact, READY Preview deployment;
 * - an uncertain start acknowledgement is terminal and is never retried;
 * - the start process receives only Vercel auth plus immutable probe bindings;
 * - no application route, database, blob, Monid, or OpenAI module is imported;
 * - all persisted identifiers are SHA-256 digests; provider cost is exactly zero;
 * - Vercel usage is a conservative estimate, never presented as actual spend.
 */

import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_DIRECTORY = path.join(REPOSITORY_ROOT, ".data", "release-evidence");
export const REDELIVERY_PROBE_WORKFLOW_ID =
  "workflow//./src/workflows/redelivery-probe//redeliveryProbeWorkflow";
const CHILD_FLAG = "--start-child";
const CHILD_ACK_TYPE = "rfp_xray_recovery_start_ack";
const CHILD_ERROR_TYPE = "rfp_xray_recovery_start_error";
const MAX_TOTAL_TIMEOUT_MS = 7 * 60_000;
const DEFAULT_START_ACK_TIMEOUT_MS = 45_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_EVENT_PAGES = 10;
const VERCEL_API_ORIGIN = "https://api.vercel.com";
const PRICING_OBSERVED_AT = "2026-09-03T00:00:00.000Z";

const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const PROJECT_ID = /^prj_[A-Za-z0-9]+$/;
const TEAM_ID = /^(?:team|user)_[A-Za-z0-9]+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^wrun_[A-Za-z0-9]+$/;

const SYSTEM_ENV_ALLOWLIST = new Set([
  "comspec",
  "lang",
  "lc_all",
  "path",
  "pathext",
  "systemroot",
  "temp",
  "tmp",
  "tmpdir",
  "tz",
  "windir"
]);

export class RecoveryProbeError extends Error {
  constructor(code, stage) {
    super(code);
    this.name = "RecoveryProbeError";
    this.code = code;
    this.stage = stage;
  }
}

function fail(code, stage) {
  throw new RecoveryProbeError(code, stage);
}

function asRecord(value, code, stage) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, stage);
  return value;
}

function requiredString(environment, name, pattern, code) {
  const value = environment[name];
  if (typeof value !== "string" || !pattern.test(value)) fail(code, "configuration");
  return value;
}

function parseInteger(value, fallback, code, minimum, maximum) {
  const candidate = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    fail(code, "configuration");
  }
  return candidate;
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseRecoveryProbeOptions(environment = process.env) {
  if (environment.RFP_XRAY_ALLOW_RECOVERY_PROBE !== "true") {
    fail("RECOVERY_PROBE_OPT_IN_REQUIRED", "configuration");
  }
  if (environment.RFP_XRAY_RECOVERY_ENVIRONMENT !== "preview") {
    fail("RECOVERY_PROBE_PREVIEW_REQUIRED", "configuration");
  }

  const token = environment.WORKFLOW_VERCEL_AUTH_TOKEN || environment.VERCEL_TOKEN;
  if (
    typeof token !== "string" || token.length < 8 || token.length > 4096 ||
    token.trim() !== token || /[\r\n]/.test(token)
  ) {
    fail("VERCEL_AUTH_TOKEN_REQUIRED", "configuration");
  }

  const binding = {
    deploymentId: requiredString(
      environment,
      "RFP_XRAY_RECOVERY_DEPLOYMENT_ID",
      DEPLOYMENT_ID,
      "RECOVERY_DEPLOYMENT_ID_INVALID"
    ),
    gitCommitSha: requiredString(
      environment,
      "RFP_XRAY_RECOVERY_GIT_COMMIT_SHA",
      GIT_SHA,
      "RECOVERY_GIT_COMMIT_SHA_INVALID"
    ),
    projectId: requiredString(
      environment,
      "RFP_XRAY_RECOVERY_PROJECT_ID",
      PROJECT_ID,
      "RECOVERY_PROJECT_ID_INVALID"
    ),
    teamId: requiredString(
      environment,
      "RFP_XRAY_RECOVERY_TEAM_ID",
      TEAM_ID,
      "RECOVERY_TEAM_ID_INVALID"
    ),
    manifestSha256: requiredString(
      environment,
      "RFP_XRAY_RECOVERY_MANIFEST_SHA256",
      SHA256,
      "RECOVERY_MANIFEST_SHA256_INVALID"
    ),
    configSha256: requiredString(
      environment,
      "RFP_XRAY_RECOVERY_CONFIG_SHA256",
      SHA256,
      "RECOVERY_CONFIG_SHA256_INVALID"
    )
  };

  const timeoutMs = parseInteger(
    environment.RFP_XRAY_RECOVERY_TIMEOUT_MS,
    MAX_TOTAL_TIMEOUT_MS,
    "RECOVERY_TIMEOUT_INVALID",
    30_000,
    MAX_TOTAL_TIMEOUT_MS
  );
  const startAckTimeoutMs = parseInteger(
    environment.RFP_XRAY_RECOVERY_START_ACK_TIMEOUT_MS,
    DEFAULT_START_ACK_TIMEOUT_MS,
    "RECOVERY_START_ACK_TIMEOUT_INVALID",
    5_000,
    60_000
  );
  const pollIntervalMs = parseInteger(
    environment.RFP_XRAY_RECOVERY_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    "RECOVERY_POLL_INTERVAL_INVALID",
    250,
    10_000
  );

  if (startAckTimeoutMs >= timeoutMs) {
    fail("RECOVERY_START_ACK_TIMEOUT_INVALID", "configuration");
  }

  return {
    environment: "preview",
    token,
    binding,
    timeoutMs,
    startAckTimeoutMs,
    pollIntervalMs
  };
}

/**
 * Build the complete child environment from an allowlist. Application/provider
 * credentials are omitted even when they exist in the invoking shell.
 */
export function buildCleanChildEnvironment(options, inherited = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (typeof value === "string" && SYSTEM_ENV_ALLOWLIST.has(key.toLowerCase())) {
      environment[key] = value;
    }
  }

  return {
    ...environment,
    NODE_ENV: "production",
    WORKFLOW_VERCEL_AUTH_TOKEN: options.token,
    RFP_XRAY_ALLOW_RECOVERY_PROBE: "true",
    RFP_XRAY_RECOVERY_ENVIRONMENT: "preview",
    RFP_XRAY_RECOVERY_DEPLOYMENT_ID: options.binding.deploymentId,
    RFP_XRAY_RECOVERY_GIT_COMMIT_SHA: options.binding.gitCommitSha,
    RFP_XRAY_RECOVERY_PROJECT_ID: options.binding.projectId,
    RFP_XRAY_RECOVERY_TEAM_ID: options.binding.teamId,
    RFP_XRAY_RECOVERY_MANIFEST_SHA256: options.binding.manifestSha256,
    RFP_XRAY_RECOVERY_CONFIG_SHA256: options.binding.configSha256,
    RFP_XRAY_RECOVERY_TIMEOUT_MS: String(options.timeoutMs),
    RFP_XRAY_RECOVERY_START_ACK_TIMEOUT_MS: String(options.startAckTimeoutMs),
    RFP_XRAY_RECOVERY_POLL_INTERVAL_MS: String(options.pollIntervalMs),
    VERCEL_DEPLOYMENT_ID: options.binding.deploymentId,
    VERCEL_GIT_COMMIT_SHA: options.binding.gitCommitSha,
    VERCEL_PROJECT_ID: options.binding.projectId,
    RFP_XRAY_VERCEL_TEAM_ID: options.binding.teamId,
    VERCEL_ORG_ID: options.binding.teamId,
    VERCEL_ENV: "preview"
  };
}

function candidateString(record, paths) {
  for (const pathParts of paths) {
    let value = record;
    for (const part of pathParts) {
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
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json"
      },
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
    if (error instanceof RecoveryProbeError) throw error;
    fail("VERCEL_PREFLIGHT_RESPONSE_INVALID", "preview_preflight");
  }
}

/**
 * Read-only verification that the immutable deployment is READY, belongs to
 * the expected project/team and commit, and is a Preview rather than Production.
 */
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

  const returnedDeploymentId = candidateString(deployment, [["uid"], ["id"]]);
  if (returnedDeploymentId !== options.binding.deploymentId || deployment.readyState !== "READY") {
    fail("VERCEL_DEPLOYMENT_NOT_READY_OR_MISMATCHED", "preview_preflight");
  }
  const deploymentProjectId = candidateString(deployment, [
    ["projectId"],
    ["project", "id"]
  ]);
  if (deploymentProjectId !== options.binding.projectId || project.id !== options.binding.projectId) {
    fail("VERCEL_PROJECT_MISMATCH", "preview_preflight");
  }
  const projectTeamId = candidateString(project, [
    ["accountId"],
    ["teamId"],
    ["team", "id"]
  ]);
  if (projectTeamId !== options.binding.teamId) {
    fail("VERCEL_TEAM_MISMATCH", "preview_preflight");
  }
  const deploymentTeamId = candidateString(deployment, [
    ["ownerId"],
    ["teamId"],
    ["team", "id"]
  ]);
  if (deploymentTeamId !== options.binding.teamId) {
    fail("VERCEL_TEAM_MISMATCH", "preview_preflight");
  }

  const target = deployment.target;
  const environment = candidateString(deployment, [
    ["environment"],
    ["meta", "vercelTargetEnvironment"],
    ["meta", "target"]
  ]);
  const isPreview = deployment.customEnvironment == null &&
    (target === null || target === "preview" ||
      (target === undefined && environment === "preview"));
  if (!isPreview || target === "production" || environment === "production") {
    fail("VERCEL_DEPLOYMENT_NOT_PREVIEW", "preview_preflight");
  }

  const gitCommitSha = candidateString(deployment, [
    ["gitSource", "sha"],
    ["meta", "githubCommitSha"],
    ["meta", "gitlabCommitSha"],
    ["meta", "bitbucketCommitSha"],
    ["meta", "gitCommitSha"]
  ]);
  if (gitCommitSha?.toLowerCase() !== options.binding.gitCommitSha) {
    fail("VERCEL_GIT_SHA_MISMATCH", "preview_preflight");
  }

  return {
    ready: true,
    environment: "preview",
    deployment_id_sha256: sha256Text(options.binding.deploymentId),
    project_id_sha256: sha256Text(options.binding.projectId),
    team_id_sha256: sha256Text(options.binding.teamId),
    git_commit_sha: options.binding.gitCommitSha
  };
}

/**
 * Invoke the supplied start operation exactly once. Every error is treated as
 * an uncertain acknowledgement because the remote queue may already have
 * accepted the run; callers must never blind-retry it.
 */
export async function startWorkflowExactlyOnce(startAttempt) {
  let acknowledgement;
  try {
    acknowledgement = await startAttempt();
  } catch {
    fail("RECOVERY_START_ACK_UNCERTAIN_NO_RETRY", "workflow_start");
  }
  if (
    !acknowledgement || typeof acknowledgement !== "object" ||
    acknowledgement.type !== CHILD_ACK_TYPE ||
    typeof acknowledgement.runId !== "string" || !RUN_ID.test(acknowledgement.runId)
  ) {
    fail("RECOVERY_START_ACK_UNCERTAIN_NO_RETRY", "workflow_start");
  }
  return acknowledgement.runId;
}

function spawnStartChildOnce(options, forker = fork) {
  const childEnvironment = buildCleanChildEnvironment(options);
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = forker(fileURLToPath(import.meta.url), [CHILD_FLAG], {
        cwd: REPOSITORY_ROOT,
        env: childEnvironment,
        execPath: process.execPath,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true
      });
    } catch {
      reject(new RecoveryProbeError("RECOVERY_START_ACK_UNCERTAIN_NO_RETRY", "workflow_start"));
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new RecoveryProbeError("RECOVERY_START_ACK_UNCERTAIN_NO_RETRY", "workflow_start"));
    }, options.startAckTimeoutMs);

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    child.once("message", (message) => {
      if (message?.type === CHILD_ERROR_TYPE) {
        finish(() => reject(
          new RecoveryProbeError("RECOVERY_START_ACK_UNCERTAIN_NO_RETRY", "workflow_start")
        ));
        return;
      }
      finish(() => resolve(message));
    });
    child.once("error", () => finish(() => reject(
      new RecoveryProbeError("RECOVERY_START_ACK_UNCERTAIN_NO_RETRY", "workflow_start")
    )));
    child.once("exit", () => {
      if (!settled) finish(() => reject(
        new RecoveryProbeError("RECOVERY_START_ACK_UNCERTAIN_NO_RETRY", "workflow_start")
      ));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withDeadline(promise, deadline, code, stage) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) fail(code, stage);
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new RecoveryProbeError(code, stage)), remaining);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function pollTerminalRun(world, runId, options, deadline) {
  while (Date.now() < deadline) {
    const run = await withDeadline(
      world.runs.get(runId, { resolveData: "none" }),
      deadline,
      "RECOVERY_RUN_TIMEOUT",
      "run_poll"
    );
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    const waitMs = Math.min(options.pollIntervalMs, Math.max(0, deadline - Date.now()));
    if (waitMs > 0) await delay(waitMs);
  }
  fail("RECOVERY_RUN_TIMEOUT", "run_poll");
}

async function listAllEvents(world, runId, deadline) {
  const events = [];
  let cursor;
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const response = await withDeadline(
      world.events.list({
        runId,
        pagination: { limit: 1000, sortOrder: "asc", ...(cursor ? { cursor } : {}) },
        resolveData: "none"
      }),
      deadline,
      "RECOVERY_EVENT_READ_TIMEOUT",
      "event_verification"
    );
    events.push(...response.data);
    if (!response.hasMore) return events;
    if (!response.cursor || response.cursor === cursor) {
      fail("RECOVERY_EVENT_PAGINATION_INVALID", "event_verification");
    }
    cursor = response.cursor;
  }
  fail("RECOVERY_EVENT_PAGE_LIMIT_EXCEEDED", "event_verification");
}

function eventAttempt(event) {
  const eventData = event && typeof event.eventData === "object" && !Array.isArray(event.eventData)
    ? event.eventData
    : null;
  return eventData?.attempt;
}

function assertExactOutput(output, binding, stepIdSha256) {
  const value = asRecord(output, "RECOVERY_OUTPUT_INVALID", "event_verification");
  for (const key of [
    "deploymentId",
    "gitCommitSha",
    "projectId",
    "teamId",
    "manifestSha256",
    "configSha256"
  ]) {
    if (value[key] !== binding[key]) fail("RECOVERY_OUTPUT_BINDING_MISMATCH", "event_verification");
  }
  if (
    value.environment !== "preview" || value.platform !== "linux" || value.attempt !== 2 ||
    value.stepIdSha256 !== stepIdSha256 ||
    typeof value.completedAt !== "string" || !Number.isFinite(Date.parse(value.completedAt))
  ) {
    fail("RECOVERY_OUTPUT_INVALID", "event_verification");
  }
}

function microUsdCeiling(usd) {
  return Math.max(1, Math.ceil(usd * 1_000_000));
}

/**
 * Conservative usage allocation for two step attempts and the two flow-handler
 * attempts surrounding one durable step. Credits and invoice rounding are not
 * treated as savings, so every component remains explicitly estimated.
 */
export function estimateVercelProbeCost(eventCount) {
  if (!Number.isInteger(eventCount) || eventCount < 1 || eventCount > 1000) {
    fail("RECOVERY_EVENT_COUNT_INVALID", "cost_estimate");
  }
  const contingency = 1.25;
  const generatedFunctionAttempts = 4;
  const routeCeilingSeconds = 300;
  const computeHourlyUsd = 0.221 + (4 * 0.0183);
  const computeUsd = generatedFunctionAttempts * routeCeilingSeconds / 3600 * computeHourlyUsd;
  const invocationUsd = eventCount * (0.60 / 1_000_000);
  const writtenGb = eventCount * 64 * 1024 / 1_000_000_000;
  const retainedGbMonths = writtenGb * (8 / 30);
  const queueOperations = eventCount * 10;

  const components = [
    {
      operation: "fluid_compute_conservative_usage_allocation",
      actual_micro_usd: null,
      estimated_micro_usd: microUsdCeiling((computeUsd + invocationUsd) * contingency),
      estimation_basis: `${generatedFunctionAttempts} generated Workflow function attempts x ${routeCeilingSeconds}s at the published 1-vCPU + 4-GiB regional rate, ${eventCount} invocation allocations, and 25% contingency; plan credits excluded.`,
      pricing_source_url: "https://vercel.com/docs/functions/usage-and-pricing"
    },
    {
      operation: "workflow_events_conservative_usage_allocation",
      actual_micro_usd: null,
      estimated_micro_usd: microUsdCeiling(eventCount * (0.02 / 1000) * contingency),
      estimation_basis: `${eventCount} observed lifecycle events at $0.02/1K plus 25% contingency; plan credits excluded.`,
      pricing_source_url: "https://vercel.com/docs/workflows/pricing"
    },
    {
      operation: "workflow_data_written_conservative_usage_allocation",
      actual_micro_usd: null,
      estimated_micro_usd: microUsdCeiling(writtenGb * 0.50 * contingency),
      estimation_basis: `${eventCount} events x 64 KiB written allocation at $0.50/GB plus 25% contingency.`,
      pricing_source_url: "https://vercel.com/docs/workflows/pricing"
    },
    {
      operation: "workflow_data_retained_conservative_usage_allocation",
      actual_micro_usd: null,
      estimated_micro_usd: microUsdCeiling(retainedGbMonths * 0.50 * contingency),
      estimation_basis: `${eventCount} events x 64 KiB retained for an eight-day allocation at $0.50/GB-month plus 25% contingency.`,
      pricing_source_url: "https://vercel.com/docs/workflows/pricing"
    },
    {
      operation: "workflow_queue_conservative_usage_allocation",
      actual_micro_usd: null,
      estimated_micro_usd: microUsdCeiling(queueOperations * (0.96 / 1_000_000) * contingency),
      estimation_basis: `${eventCount} events x ten Queue operation units at $0.96/M plus 25% contingency; the internal Workflow-to-Queue mapping is an allocation, not a provider receipt.`,
      pricing_source_url: "https://vercel.com/docs/pricing/regional-pricing"
    }
  ].map((component) => ({
    provider: "vercel",
    status: "succeeded",
    cost_classification: "estimated",
    pricing_observed_at: PRICING_OBSERVED_AT,
    ...component
  }));

  return {
    actual_micro_usd: null,
    estimated_micro_usd: components.reduce(
      (total, component) => total + component.estimated_micro_usd,
      0
    ),
    components
  };
}

/**
 * Validate the complete provider event log, then return a sanitized receipt.
 */
export function buildRecoveryEvidence({ binding, run, events, output, startedAt, finishedAt }) {
  const runRecord = asRecord(run, "RECOVERY_RUN_INVALID", "event_verification");
  if (
    typeof runRecord.runId !== "string" || !RUN_ID.test(runRecord.runId) ||
    runRecord.status !== "completed" ||
    runRecord.deploymentId !== binding.deploymentId ||
    runRecord.workflowName !== REDELIVERY_PROBE_WORKFLOW_ID
  ) {
    fail("RECOVERY_RUN_INVALID", "event_verification");
  }
  if (!Array.isArray(events) || events.length < 1 || events.some((event) => event.runId !== runRecord.runId)) {
    fail("RECOVERY_EVENT_LOG_INVALID", "event_verification");
  }

  const stepStarted = events.filter((event) => event.eventType === "step_started");
  const stepCompleted = events.filter((event) => event.eventType === "step_completed");
  const retryOrFailure = events.filter((event) =>
    ["step_retrying", "step_failed", "run_failed", "run_cancelled"].includes(event.eventType)
  );
  const runCompleted = events.filter((event) => event.eventType === "run_completed");
  if (stepStarted.length !== 2 || stepCompleted.length !== 1 || retryOrFailure.length !== 0 ||
    runCompleted.length !== 1) {
    fail("RECOVERY_EVENT_CARDINALITY_INVALID", "event_verification");
  }

  const stepIds = new Set(stepStarted.map((event) => event.correlationId));
  if (
    stepIds.size !== 1 || typeof stepStarted[0].correlationId !== "string" ||
    stepCompleted[0].correlationId !== stepStarted[0].correlationId ||
    stepStarted.map(eventAttempt).some((attempt) => !Number.isInteger(attempt)) ||
    stepStarted.map(eventAttempt).join(",") !== "1,2" ||
    events.some((event) => event.eventType === "step_started" && eventAttempt(event) >= 3)
  ) {
    fail("RECOVERY_REDELIVERY_SEQUENCE_INVALID", "event_verification");
  }

  const stepIdSha256 = sha256Text(stepStarted[0].correlationId);
  assertExactOutput(output, binding, stepIdSha256);
  const startTime = new Date(startedAt);
  const finishTime = new Date(finishedAt);
  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(finishTime.getTime()) ||
    finishTime < startTime) {
    fail("RECOVERY_EVIDENCE_TIME_INVALID", "event_verification");
  }

  const vercelCost = estimateVercelProbeCost(events.length);
  return {
    schema_version: "rfp-xray/workflow-redelivery-evidence@1",
    generated_at: finishTime.toISOString(),
    scope: {
      environment: "preview",
      platform: "linux",
      deployment_id_sha256: sha256Text(binding.deploymentId),
      git_commit_sha: binding.gitCommitSha,
      project_id_sha256: sha256Text(binding.projectId),
      team_id_sha256: sha256Text(binding.teamId),
      manifest_sha256: binding.manifestSha256,
      config_sha256: binding.configSha256
    },
    observations: {
      workflow_name: REDELIVERY_PROBE_WORKFLOW_ID,
      run_id_sha256: sha256Text(runRecord.runId),
      step_id_sha256: stepIdSha256,
      event_id_sha256: events.map((event) => sha256Text(event.eventId)).sort(),
      run_status: "completed",
      step_started_attempts: [1, 2],
      step_completed_count: 1,
      step_retrying_count: 0,
      step_failed_count: 0,
      third_attempt_count: 0,
      run_completed_count: 1,
      duration_ms: finishTime.getTime() - startTime.getTime()
    },
    assertions: {
      exact_preview_binding: true,
      first_attempt_hard_killed: true,
      same_step_redelivered_once: true,
      second_attempt_completed: true,
      no_retry_event_emitted: true,
      no_third_attempt: true,
      run_completed: true
    },
    provider_calls: {
      monid: 0,
      openai: 0,
      database: 0,
      blob: 0
    },
    costs: {
      provider: {
        cost_classification: "actual",
        actual_micro_usd: 0,
        estimated_micro_usd: null,
        basis: "The isolated canary imports and calls no document, model, database, or blob provider."
      },
      vercel: {
        cost_classification: "estimated",
        ...vercelCost
      }
    }
  };
}

async function writeEvidence(evidence) {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const timestamp = evidence.generated_at.replace(/[:.]/g, "-");
  const suffix = evidence.observations.run_id_sha256.slice(0, 12);
  const evidencePath = path.join(
    EVIDENCE_DIRECTORY,
    `workflow-redelivery-probe-${timestamp}-${suffix}.json`
  );
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  return evidencePath;
}

async function runStartChild() {
  let message;
  try {
    const options = parseRecoveryProbeOptions(process.env);
    const [{ createVercelWorld }, { start }, { setWorld }] = await Promise.all([
      import("@workflow/world-vercel"),
      import("workflow/api"),
      import("workflow/runtime")
    ]);
    const world = createVercelWorld({
      token: options.token,
      projectConfig: {
        projectId: options.binding.projectId,
        teamId: options.binding.teamId,
        environment: "preview"
      }
    });
    setWorld(world);
    const run = await start(
      { workflowId: REDELIVERY_PROBE_WORKFLOW_ID },
      [options.binding],
      { deploymentId: options.binding.deploymentId, world }
    );
    message = { type: CHILD_ACK_TYPE, runId: run.runId };
  } catch {
    message = { type: CHILD_ERROR_TYPE };
  }

  if (typeof process.send !== "function") process.exit(1);
  process.send(message, () => process.exit(message.type === CHILD_ACK_TYPE ? 0 : 1));
}

export async function runRecoveryProbe(environment = process.env) {
  const options = parseRecoveryProbeOptions(environment);
  const startedAt = new Date();
  const deadline = startedAt.getTime() + options.timeoutMs;

  await withDeadline(
    verifyPreviewDeployment(options),
    deadline,
    "RECOVERY_PREFLIGHT_TIMEOUT",
    "preview_preflight"
  );

  const runId = await startWorkflowExactlyOnce(() => spawnStartChildOnce(options));
  const [{ createVercelWorld }, { getRun }, { setWorld }] = await Promise.all([
    import("@workflow/world-vercel"),
    import("workflow/api"),
    import("workflow/runtime")
  ]);
  const world = createVercelWorld({
    token: options.token,
    projectConfig: {
      projectId: options.binding.projectId,
      teamId: options.binding.teamId,
      environment: "preview"
    }
  });
  setWorld(world);

  const run = await pollTerminalRun(world, runId, options, deadline);
  if (run.status !== "completed") fail("RECOVERY_RUN_DID_NOT_COMPLETE", "run_poll");
  const events = await listAllEvents(world, runId, deadline);
  const output = await withDeadline(
    getRun(runId).returnValue,
    deadline,
    "RECOVERY_OUTPUT_TIMEOUT",
    "event_verification"
  );
  const evidence = buildRecoveryEvidence({
    binding: options.binding,
    run,
    events,
    output,
    startedAt,
    finishedAt: new Date()
  });
  const evidencePath = await writeEvidence(evidence);
  return { evidence, evidencePath };
}

async function main() {
  try {
    const result = await runRecoveryProbe();
    process.stdout.write(`${JSON.stringify({
      ok: true,
      evidence_path: path.relative(REPOSITORY_ROOT, result.evidencePath),
      run_id_sha256: result.evidence.observations.run_id_sha256,
      step_started_attempts: result.evidence.observations.step_started_attempts,
      provider_actual_micro_usd: result.evidence.costs.provider.actual_micro_usd,
      vercel_estimated_micro_usd: result.evidence.costs.vercel.estimated_micro_usd
    })}\n`);
  } catch (error) {
    const failure = error instanceof RecoveryProbeError
      ? error
      : new RecoveryProbeError("RECOVERY_PROBE_FAILED", "unknown");
    process.stderr.write(`${JSON.stringify({ ok: false, code: failure.code, stage: failure.stage })}\n`);
    process.exitCode = 1;
  }
}

const isDirectExecution = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) {
  if (process.argv.includes(CHILD_FLAG)) {
    await runStartChild();
  } else {
    await main();
  }
}
