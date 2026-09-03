import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";

export const ATTESTATION_KIND = "vercel_workflow_runtime/v1";
export const REQUIRED_TIMEOUT_SECONDS = 300;
export const MAX_TTL_HOURS = 168;
export const EXPECTED_WORKFLOW_PACKAGE_VERSION = "4.8.5";
export const EXPECTED_NODE_RUNTIME = "nodejs22.x";
export const MIN_MEMORY_MB = 2048;
export const WORKFLOW_ROUTES = [
  ".well-known/workflow/v1/flow",
  ".well-known/workflow/v1/step"
];
export const INTERNAL_DEADLINES_MS = {
  live_network: 105_000,
  pre_model: 150_000,
  result_commit: 285_000
};

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.safeCode = code;
  throw error;
}

function canonicalDeploymentUrl(value) {
  try {
    const candidate = value.includes("://") ? value : `https://${value}`;
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.search || url.hash || !["", "/"].includes(url.pathname)) {
      fail("INVALID_DEPLOYMENT_URL");
    }
    return url.hostname.toLowerCase();
  } catch (error) {
    if (error?.safeCode) throw error;
    fail("INVALID_DEPLOYMENT_URL");
  }
}

function requiredString(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}

export function buildWorkflowRuntimeAttestation({
  inspection,
  project,
  scope,
  gitCommitSha,
  workflowPackageVersion,
  issuedAt,
  expiresAt
}) {
  if (!inspection || inspection.target !== "production") fail("NOT_PRODUCTION");
  if (inspection.readyState !== "READY") fail("DEPLOYMENT_NOT_READY");
  if (inspection.name !== project.projectName || inspection.contextName !== scope) {
    fail("WRONG_PROJECT");
  }
  requiredString(project.projectName, /^\S(?:.*\S)?$/, "INVALID_PROJECT_NAME");
  requiredString(scope, /^\S(?:.*\S)?$/, "INVALID_TEAM_SCOPE");
  const deploymentId = requiredString(
    inspection.id,
    /^dpl_[A-Za-z0-9]+$/,
    "INVALID_DEPLOYMENT_ID"
  );
  const projectId = requiredString(project.projectId, /^prj_[A-Za-z0-9]+$/, "INVALID_PROJECT_ID");
  const teamId = requiredString(
    project.orgId,
    /^(?:team|user)_[A-Za-z0-9]+$/,
    "INVALID_TEAM_ID"
  );
  const commitSha = requiredString(
    typeof gitCommitSha === "string" ? gitCommitSha.toLowerCase() : "",
    /^[a-f0-9]{40}$/,
    "INVALID_GIT_SHA"
  );
  if (workflowPackageVersion !== EXPECTED_WORKFLOW_PACKAGE_VERSION) {
    fail("INVALID_WORKFLOW_VERSION");
  }
  const issuedMs = issuedAt.getTime();
  const expiresMs = expiresAt.getTime();
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs) || expiresMs <= issuedMs ||
    expiresMs - issuedMs > MAX_TTL_HOURS * 60 * 60_000) {
    fail("INVALID_ATTESTATION_LIFETIME");
  }

  const outputs = Array.isArray(inspection.builds)
    ? inspection.builds.flatMap((build) => Array.isArray(build?.output) ? build.output : [])
    : [];
  const routeFunctions = {};
  for (const route of WORKFLOW_ROUTES) {
    const matches = outputs.filter((output) => output?.path === route);
    if (matches.length !== 1) fail("WORKFLOW_ROUTE_MISSING_OR_DUPLICATED");
    const timeout = matches[0]?.lambda?.timeout;
    if (!Number.isInteger(timeout) || timeout < REQUIRED_TIMEOUT_SECONDS) {
      fail("WORKFLOW_ROUTE_TIMEOUT_TOO_SHORT");
    }
    const nodeRuntime = matches[0]?.lambda?.runtime;
    if (nodeRuntime !== EXPECTED_NODE_RUNTIME) fail("WORKFLOW_NODE_RUNTIME_MISMATCH");
    const memoryMb = matches[0]?.lambda?.memorySize;
    if (!Number.isInteger(memoryMb) || memoryMb < MIN_MEMORY_MB) {
      fail("WORKFLOW_MEMORY_TOO_SMALL");
    }
    const rawRegions = matches[0]?.lambda?.deployedTo;
    if (!Array.isArray(rawRegions) || rawRegions.length === 0 ||
      rawRegions.some((region) => typeof region !== "string" || !/^[a-z]{3}\d$/.test(region))) {
      fail("WORKFLOW_REGIONS_INVALID");
    }
    const regions = [...new Set(rawRegions)].sort();
    routeFunctions[route] = {
      timeout_seconds: timeout,
      node_runtime: nodeRuntime,
      memory_mb: memoryMb,
      regions
    };
  }

  const payload = {
    version: 1,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    deployment: {
      id: deploymentId,
      url: canonicalDeploymentUrl(inspection.url),
      target: "production",
      ready_state: "READY",
      project: { id: projectId, name: project.projectName },
      team: { id: teamId, slug: scope },
      git_commit_sha: commitSha
    },
    workflow: {
      package_version: workflowPackageVersion,
      required_min_timeout_seconds: REQUIRED_TIMEOUT_SECONDS,
      analysis_step_max_duration_seconds: REQUIRED_TIMEOUT_SECONDS,
      route_functions: routeFunctions,
      internal_deadlines_ms: INTERNAL_DEADLINES_MS
    }
  };
  const payloadSha256 = sha256Hex(stableJson(payload));
  return { payload, payloadSha256 };
}

export function parseReleaseArguments(argv) {
  const values = new Map();
  const allowed = new Set(["deployment", "scope", "ttl-hours", "project-file", "confirm-store"]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      fail("INVALID_ARGUMENTS");
    }
    const normalizedKey = key.slice(2);
    if (!allowed.has(normalizedKey) || values.has(normalizedKey)) fail("INVALID_ARGUMENTS");
    values.set(normalizedKey, value);
  }
  const deployment = values.get("deployment");
  const scope = values.get("scope");
  if (!deployment || !scope) fail("INVALID_ARGUMENTS");
  if (values.get("confirm-store") !== ATTESTATION_KIND) fail("STORE_NOT_CONFIRMED");
  const ttlHours = Number(values.get("ttl-hours") ?? "24");
  if (!Number.isInteger(ttlHours) || ttlHours <= 0 || ttlHours > MAX_TTL_HOURS) {
    fail("INVALID_TTL");
  }
  return {
    deployment,
    scope,
    ttlHours,
    projectFile: resolve(values.get("project-file") ?? ".vercel/project.json")
  };
}

export function buildReleaseSubprocessEnvironment(
  sourceEnvironment,
  includeVercelToken = false
) {
  const allowedNames = [
    "PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC",
    "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"
  ];
  const environment = {};
  for (const name of allowedNames) {
    if (sourceEnvironment[name]) environment[name] = sourceEnvironment[name];
  }
  if (includeVercelToken && sourceEnvironment.VERCEL_TOKEN) {
    environment.VERCEL_TOKEN = sourceEnvironment.VERCEL_TOKEN;
  }
  environment.CI = "1";
  environment.NO_UPDATE_NOTIFIER = "1";
  environment.VERCEL_TELEMETRY_DISABLED = "1";
  return environment;
}

function subprocessEnvironment(includeVercelToken = false) {
  return buildReleaseSubprocessEnvironment(process.env, includeVercelToken);
}

function run(
  command,
  args,
  code,
  { maxBuffer = 2 * 1024 * 1024, timeoutMs = 30_000, cwd = process.cwd(), env } = {}
) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: env ?? subprocessEnvironment(false),
    shell: false,
    maxBuffer,
    timeout: timeoutMs,
    windowsHide: true
  });
  if (result.status !== 0 || typeof result.stdout !== "string") fail(code);
  return result.stdout.trim();
}

function parseInspection(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) fail("INVALID_INSPECT_OUTPUT");
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    fail("INVALID_INSPECT_OUTPUT");
  }
}

async function main() {
  const args = parseReleaseArguments(process.argv.slice(2));
  if (!process.env.DATABASE_URL) fail("DATABASE_NOT_CONFIGURED");
  if (run("git", ["status", "--porcelain"], "GIT_STATUS_FAILED") !== "") {
    fail("DIRTY_WORKTREE");
  }
  const gitCommitSha = run("git", ["rev-parse", "HEAD"], "GIT_SHA_FAILED");
  let project;
  let packageJson;
  try {
    project = JSON.parse(await readFile(args.projectFile, "utf8"));
    packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  } catch {
    fail("LOCAL_METADATA_UNAVAILABLE");
  }
  const installedVercelPackagePath = resolve("node_modules/vercel/package.json");
  const installedVercelCliPath = resolve("node_modules/vercel/dist/vc.js");
  let inspectDirectory;
  let inspection;
  try {
    const installedVercel = JSON.parse(await readFile(installedVercelPackagePath, "utf8"));
    if (installedVercel.version !== "59.11.2") fail("VERCEL_CLI_VERSION_MISMATCH");
    inspectDirectory = await mkdtemp(join(tmpdir(), "rfp-xray-vercel-inspect-"));
    inspection = parseInspection(run(
      process.execPath,
      [installedVercelCliPath, "inspect", args.deployment, "--json", "--scope", args.scope],
      "VERCEL_INSPECT_FAILED",
      {
        maxBuffer: 64 * 1024 * 1024,
        timeoutMs: 120_000,
        cwd: inspectDirectory,
        env: subprocessEnvironment(true)
      }
    ));
  } finally {
    if (inspectDirectory) {
      const safeTempRoot = `${resolve(tmpdir())}${sep}`;
      const safeTarget = resolve(inspectDirectory);
      if (safeTarget.startsWith(safeTempRoot) &&
        safeTarget.slice(safeTempRoot.length).startsWith("rfp-xray-vercel-inspect-")) {
        await rm(safeTarget, { recursive: true, force: true });
      }
    }
  }
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + args.ttlHours * 60 * 60_000);
  const workflowPackageVersion = packageJson?.dependencies?.workflow;
  const { payload, payloadSha256 } = buildWorkflowRuntimeAttestation({
    inspection,
    project,
    scope: args.scope,
    gitCommitSha,
    workflowPackageVersion,
    issuedAt,
    expiresAt
  });

  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      INSERT INTO release_attestations (
        kind, deployment_id, deployment_url, project_id, team_id,
        git_commit_sha, payload, payload_sha256, issued_at, expires_at, updated_at
      ) VALUES (
        ${ATTESTATION_KIND}, ${payload.deployment.id}, ${payload.deployment.url},
        ${payload.deployment.project.id}, ${payload.deployment.team.id},
        ${payload.deployment.git_commit_sha}, ${JSON.stringify(payload)}::jsonb,
        ${payloadSha256}, ${issuedAt}, ${expiresAt}, ${issuedAt}
      )
      ON CONFLICT (kind, deployment_id) DO UPDATE SET
        deployment_url = EXCLUDED.deployment_url,
        project_id = EXCLUDED.project_id,
        team_id = EXCLUDED.team_id,
        git_commit_sha = EXCLUDED.git_commit_sha,
        payload = EXCLUDED.payload,
        payload_sha256 = EXCLUDED.payload_sha256,
        issued_at = EXCLUDED.issued_at,
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at
    `;
  } catch {
    fail("ATTESTATION_STORE_FAILED");
  }

  process.stdout.write(`${JSON.stringify({
    status: "stored",
    kind: ATTESTATION_KIND,
    deployment_id: payload.deployment.id,
    payload_sha256: payloadSha256,
    expires_at: payload.expires_at
  })}\n`);
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedUrl === import.meta.url) {
  main().catch((error) => {
    const code = typeof error?.safeCode === "string" ? error.safeCode : "ATTESTATION_FAILED";
    process.stderr.write(`${JSON.stringify({ status: "failed", code })}\n`);
    process.exitCode = 1;
  });
}
