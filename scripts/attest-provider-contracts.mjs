import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { BlockList, isIP } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";

export const ATTESTATION_KIND = "provider_contracts/v1";
export const MAX_TTL_HOURS = 24;
export const MONID_ORIGIN = "https://api.monid.ai";
export const MONID_INSPECT_PATH = "/v1/inspect";
export const MONID_RUN_PATH = "/v1/run";
export const MONID_RUN_STATUS_PATH_TEMPLATE = "/v1/runs/{run_id}";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function hmacSha256Hex(secret, value) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.safeCode = code;
  throw error;
}

function requiredCanonicalString(value, code, maximum = 512) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum ||
    value !== value.trim()) fail(code);
  return value;
}

function requiredString(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
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

function canonicalArtifactHosts(raw) {
  if (typeof raw !== "string" || !raw) fail("PROVIDER_CONFIG_INVALID");
  const hosts = raw.split(",").map((item) => item.trim().toLowerCase());
  if (hosts.length < 1 || new Set(hosts).size !== hosts.length) fail("PROVIDER_CONFIG_INVALID");
  for (const hostname of hosts) {
    if (!hostname || hostname.length > 253 || hostname.includes("*") || hostname.includes("/")) {
      fail("PROVIDER_CONFIG_INVALID");
    }
    try {
      const url = new URL(`https://${hostname}`);
      if (url.hostname !== hostname || url.host !== hostname || url.pathname !== "/" ||
        url.port || url.username || url.password) fail("PROVIDER_CONFIG_INVALID");
    } catch (error) {
      if (error?.safeCode) throw error;
      fail("PROVIDER_CONFIG_INVALID");
    }
  }
  return [...hosts].sort();
}

export function providerConfigurationFromEnvironment(environment) {
  let monidBase;
  try {
    monidBase = new URL(environment.MONID_API_BASE_URL ?? MONID_ORIGIN);
  } catch {
    fail("PROVIDER_ORIGIN_INVALID");
  }
  if (monidBase.origin !== MONID_ORIGIN || monidBase.pathname !== "/" ||
    monidBase.username || monidBase.password || monidBase.port ||
    monidBase.search || monidBase.hash) {
    fail("PROVIDER_ORIGIN_INVALID");
  }
  const inspectSchemaSha256 = requiredString(
    environment.MONID_INSPECT_SCHEMA_SHA256,
    /^[a-f0-9]{64}$/,
    "PROVIDER_CONFIG_INVALID"
  );
  const costValueUnit = environment.MONID_COST_VALUE_UNIT;
  if (!["currency_major", "micro_dollar"].includes(costValueUnit)) {
    fail("PROVIDER_CONFIG_INVALID");
  }
  const extractionModel = requiredCanonicalString(
    environment.OPENAI_EXTRACTION_MODEL ?? "gpt-5.4-mini",
    "PROVIDER_CONFIG_INVALID"
  );
  const qaModel = requiredCanonicalString(
    environment.OPENAI_QA_MODEL ?? "gpt-5.4-mini",
    "PROVIDER_CONFIG_INVALID"
  );
  const checkedModels = [...new Set([extractionModel, qaModel])].sort();
  return {
    monid: {
      api_origin: MONID_ORIGIN,
      inspect_path: MONID_INSPECT_PATH,
      run_path: MONID_RUN_PATH,
      run_status_path_template: MONID_RUN_STATUS_PATH_TEMPLATE,
      provider: requiredCanonicalString(environment.MONID_PARSE_PROVIDER, "PROVIDER_CONFIG_INVALID"),
      endpoint: requiredCanonicalString(environment.MONID_PARSE_ENDPOINT, "PROVIDER_CONFIG_INVALID"),
      run_id_path: requiredCanonicalString(environment.MONID_RUN_ID_PATH, "PROVIDER_CONFIG_INVALID"),
      run_status_path: requiredCanonicalString(environment.MONID_RUN_STATUS_PATH, "PROVIDER_CONFIG_INVALID"),
      provider_status_path: requiredCanonicalString(environment.MONID_PROVIDER_STATUS_PATH, "PROVIDER_CONFIG_INVALID"),
      result_url_path: requiredCanonicalString(environment.MONID_RESULT_URL_PATH, "PROVIDER_CONFIG_INVALID"),
      cost_value_path: requiredCanonicalString(environment.MONID_COST_VALUE_PATH, "PROVIDER_CONFIG_INVALID"),
      cost_currency_path: requiredCanonicalString(environment.MONID_COST_CURRENCY_PATH, "PROVIDER_CONFIG_INVALID"),
      cost_value_unit: costValueUnit,
      artifact_hosts: canonicalArtifactHosts(environment.MONID_ARTIFACT_HOST_ALLOWLIST),
      inspect_schema_sha256: inspectSchemaSha256
    },
    openai: {
      api_base_url: OPENAI_BASE_URL,
      extraction_model: extractionModel,
      qa_model: qaModel,
      checked_models: checkedModels
    }
  };
}

export function parseReleaseArguments(argv) {
  const values = new Map();
  const allowed = new Set(["deployment", "scope", "ttl-hours", "project-file", "confirm-store"]);
  if (argv.length % 2 !== 0) fail("INVALID_ARGUMENTS");
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      fail("INVALID_ARGUMENTS");
    }
    const normalized = key.slice(2);
    if (!allowed.has(normalized) || values.has(normalized)) fail("INVALID_ARGUMENTS");
    values.set(normalized, value);
  }
  if (!values.get("deployment") || !values.get("scope")) fail("INVALID_ARGUMENTS");
  if (values.get("confirm-store") !== ATTESTATION_KIND) fail("STORE_NOT_CONFIRMED");
  const ttlHours = Number(values.get("ttl-hours") ?? "24");
  if (!Number.isInteger(ttlHours) || ttlHours <= 0 || ttlHours > MAX_TTL_HOURS) {
    fail("INVALID_TTL");
  }
  return {
    deployment: values.get("deployment"),
    scope: values.get("scope"),
    ttlHours,
    projectFile: resolve(values.get("project-file") ?? ".vercel/project.json")
  };
}

export function buildReleaseSubprocessEnvironment(sourceEnvironment, includeVercelToken = false) {
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

function run(command, args, code, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: options.env ?? buildReleaseSubprocessEnvironment(process.env),
    shell: false,
    maxBuffer: options.maxBuffer ?? 2 * 1024 * 1024,
    timeout: options.timeoutMs ?? 30_000,
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

const blockedIpv4Addresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.31.196.0", 24],
  ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
]) blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
const blockedIpv6Addresses = new BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96],
  ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20], ["5f00::", 16],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]
]) blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");

export function isGloballyReachableAddress(address) {
  const kind = isIP(address);
  try {
    if (kind === 4) return !blockedIpv4Addresses.check(address, "ipv4");
    if (kind === 6) return !blockedIpv6Addresses.check(address, "ipv6");
  } catch {
    return false;
  }
  return false;
}

async function defaultResolveHostname(hostname) {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

async function boundedJson(response, maximumBytes = 2 * 1024 * 1024) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) fail("PROVIDER_RESPONSE_INVALID");
  if (!response.body) fail("PROVIDER_RESPONSE_INVALID");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) fail("PROVIDER_RESPONSE_INVALID");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    fail("PROVIDER_RESPONSE_INVALID");
  }
}

async function assertPublicTarget(url, resolveHostname) {
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
    url.search || url.hash) fail("PROVIDER_ORIGIN_INVALID");
  let addresses;
  try {
    addresses = await resolveHostname(url.hostname);
  } catch {
    fail("PROVIDER_DNS_UNSAFE");
  }
  if (!Array.isArray(addresses) || addresses.length < 1 ||
    addresses.some((address) => !isGloballyReachableAddress(address))) {
    fail("PROVIDER_DNS_UNSAFE");
  }
}

async function credentialedJsonRequest(url, init, credential, options) {
  await assertPublicTarget(url, options.resolveHostname);
  let response;
  try {
    response = await options.fetcher(url, {
      ...init,
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        authorization: `Bearer ${credential}`,
        accept: "application/json",
        ...init.headers
      },
      signal: AbortSignal.timeout(20_000)
    });
  } catch {
    fail("PROVIDER_CHECK_UNAVAILABLE");
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    fail("PROVIDER_REDIRECT_REJECTED");
  }
  if (!response.ok) {
    await response.body?.cancel();
    fail("PROVIDER_CHECK_FAILED");
  }
  return boundedJson(response);
}

export async function performProviderChecks({
  configuration,
  monidApiKey,
  openaiApiKey,
  fetcher = fetch,
  resolveHostname = defaultResolveHostname
}) {
  requiredCanonicalString(monidApiKey, "MONID_CREDENTIAL_MISSING", 16_384);
  requiredCanonicalString(openaiApiKey, "OPENAI_CREDENTIAL_MISSING", 16_384);
  if (configuration?.monid?.api_origin !== MONID_ORIGIN ||
    configuration?.openai?.api_base_url !== OPENAI_BASE_URL) {
    fail("PROVIDER_ORIGIN_INVALID");
  }
  const monidInspect = await credentialedJsonRequest(
    new URL(MONID_INSPECT_PATH, `${MONID_ORIGIN}/`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: configuration.monid.provider,
        endpoint: configuration.monid.endpoint
      })
    },
    monidApiKey,
    { fetcher, resolveHostname }
  );
  const monidInspectSha256 = sha256Hex(stableJson(monidInspect));
  if (!constantTimeHexEqual(
    monidInspectSha256,
    configuration.monid.inspect_schema_sha256
  )) fail("MONID_INSPECT_HASH_MISMATCH");

  const checkedModels = [];
  for (const model of configuration.openai.checked_models) {
    const modelUrl = new URL(`${OPENAI_BASE_URL}/models/${encodeURIComponent(model)}`);
    const response = await credentialedJsonRequest(
      modelUrl,
      { method: "GET" },
      openaiApiKey,
      { fetcher, resolveHostname }
    );
    if (!response || typeof response !== "object" || response.id !== model) {
      fail("OPENAI_MODEL_MISMATCH");
    }
    checkedModels.push(model);
  }
  return { monidInspectSha256, checkedModels };
}

export function providerCredentialBindingsForDeployment({
  deploymentId,
  deploymentUrl,
  projectId,
  teamId,
  gitCommitSha,
  monidApiKey,
  openaiApiKey
}) {
  requiredCanonicalString(monidApiKey, "MONID_CREDENTIAL_MISSING", 16_384);
  requiredCanonicalString(openaiApiKey, "OPENAI_CREDENTIAL_MISSING", 16_384);
  const identity = {
    kind: ATTESTATION_KIND,
    deployment_id: requiredString(deploymentId, /^dpl_[A-Za-z0-9]+$/, "INVALID_DEPLOYMENT_ID"),
    deployment_url: canonicalDeploymentUrl(deploymentUrl),
    project_id: requiredString(projectId, /^prj_[A-Za-z0-9]+$/, "INVALID_PROJECT_ID"),
    team_id: requiredString(teamId, /^(?:team|user)_[A-Za-z0-9]+$/, "INVALID_TEAM_ID"),
    git_commit_sha: requiredString(
      typeof gitCommitSha === "string" ? gitCommitSha.toLowerCase() : "",
      /^[a-f0-9]{40}$/,
      "INVALID_GIT_SHA"
    )
  };
  const base = stableJson(identity);
  return {
    monid_hmac_sha256: hmacSha256Hex(monidApiKey, `${base}\nprovider=monid`),
    openai_hmac_sha256: hmacSha256Hex(openaiApiKey, `${base}\nprovider=openai`)
  };
}

export function buildProviderContractsAttestation({
  inspection,
  project,
  scope,
  gitCommitSha,
  configuration,
  checks,
  issuedAt,
  expiresAt
}) {
  if (!inspection || inspection.target !== "production") fail("NOT_PRODUCTION");
  if (inspection.readyState !== "READY") fail("DEPLOYMENT_NOT_READY");
  if (inspection.name !== project.projectName || inspection.contextName !== scope) {
    fail("WRONG_PROJECT");
  }
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
  const issuedMs = issuedAt.getTime();
  const expiresMs = expiresAt.getTime();
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs) || expiresMs <= issuedMs ||
    expiresMs - issuedMs > MAX_TTL_HOURS * 60 * 60_000) {
    fail("INVALID_ATTESTATION_LIFETIME");
  }
  if (!constantTimeHexEqual(
    checks.monidInspectSha256,
    configuration.monid.inspect_schema_sha256
  ) || stableJson(checks.checkedModels) !== stableJson(configuration.openai.checked_models)) {
    fail("PROVIDER_CHECK_MISMATCH");
  }
  if (!checks.credentialBindings ||
    !/^[a-f0-9]{64}$/.test(checks.credentialBindings.monid_hmac_sha256) ||
    !/^[a-f0-9]{64}$/.test(checks.credentialBindings.openai_hmac_sha256)) {
    fail("PROVIDER_CREDENTIAL_BINDING_INVALID");
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
      project: {
        id: projectId,
        name: requiredCanonicalString(project.projectName, "INVALID_PROJECT_NAME")
      },
      team: {
        id: teamId,
        slug: requiredCanonicalString(scope, "INVALID_TEAM_SCOPE")
      },
      git_commit_sha: commitSha
    },
    contracts: configuration,
    credential_bindings: checks.credentialBindings,
    checks: {
      monid_inspect: {
        status: "verified_non_paid",
        canonical_response_sha256: checks.monidInspectSha256
      },
      openai_models: checks.checkedModels.map((model) => ({
        model,
        status: "available_non_paid"
      }))
    }
  };
  return { payload, payloadSha256: sha256Hex(stableJson(payload)) };
}

async function main() {
  const args = parseReleaseArguments(process.argv.slice(2));
  if (!process.env.DATABASE_URL) fail("DATABASE_NOT_CONFIGURED");
  if (!process.env.MONID_API_KEY) fail("MONID_CREDENTIAL_MISSING");
  if (!process.env.OPENAI_API_KEY) fail("OPENAI_CREDENTIAL_MISSING");
  if (run("git", ["status", "--porcelain"], "GIT_STATUS_FAILED") !== "") {
    fail("DIRTY_WORKTREE");
  }
  const gitCommitSha = run("git", ["rev-parse", "HEAD"], "GIT_SHA_FAILED");
  let project;
  let installedVercel;
  try {
    project = JSON.parse(await readFile(args.projectFile, "utf8"));
    installedVercel = JSON.parse(await readFile(resolve("node_modules/vercel/package.json"), "utf8"));
  } catch {
    fail("LOCAL_METADATA_UNAVAILABLE");
  }
  if (installedVercel.version !== "59.11.2") fail("VERCEL_CLI_VERSION_MISMATCH");
  let inspectDirectory;
  let inspection;
  try {
    inspectDirectory = await mkdtemp(join(tmpdir(), "rfp-xray-provider-inspect-"));
    inspection = parseInspection(run(
      process.execPath,
      [
        resolve("node_modules/vercel/dist/vc.js"),
        "inspect",
        args.deployment,
        "--json",
        "--scope",
        args.scope
      ],
      "VERCEL_INSPECT_FAILED",
      {
        cwd: inspectDirectory,
        maxBuffer: 64 * 1024 * 1024,
        timeoutMs: 120_000,
        env: buildReleaseSubprocessEnvironment(process.env, true)
      }
    ));
  } finally {
    if (inspectDirectory) {
      const safeTempRoot = `${resolve(tmpdir())}${sep}`;
      const safeTarget = resolve(inspectDirectory);
      if (safeTarget.startsWith(safeTempRoot) &&
        safeTarget.slice(safeTempRoot.length).startsWith("rfp-xray-provider-inspect-")) {
        await rm(safeTarget, { recursive: true, force: true });
      }
    }
  }
  const configuration = providerConfigurationFromEnvironment(process.env);
  const providerChecks = await performProviderChecks({
    configuration,
    monidApiKey: process.env.MONID_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY
  });
  const credentialBindings = providerCredentialBindingsForDeployment({
    deploymentId: inspection.id,
    deploymentUrl: inspection.url,
    projectId: project.projectId,
    teamId: project.orgId,
    gitCommitSha,
    monidApiKey: process.env.MONID_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY
  });
  const checks = { ...providerChecks, credentialBindings };
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + args.ttlHours * 60 * 60_000);
  const { payload, payloadSha256 } = buildProviderContractsAttestation({
    inspection,
    project,
    scope: args.scope,
    gitCommitSha,
    configuration,
    checks,
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
