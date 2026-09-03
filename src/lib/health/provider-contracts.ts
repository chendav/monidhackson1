import { z } from "zod";
import type { ReleaseAttestationRow } from "@/db/release-attestation-store";
import type { AppConfig } from "@/lib/config";
import { constantTimeHexEqual, hmacSha256Hex, sha256Hex, stableJson } from "@/lib/crypto";
import { AppError } from "@/lib/errors";

export const PROVIDER_CONTRACTS_ATTESTATION_KIND = "provider_contracts/v1" as const;
export const PROVIDER_CONTRACTS_ATTESTATION_VERSION = 1 as const;
export const PROVIDER_CONTRACTS_ATTESTATION_MAX_AGE_MS = 24 * 60 * 60_000;
export const PROVIDER_CONTRACTS_MAX_FUTURE_SKEW_MS = 60_000;
// An accepted receipt must remain valid for the full attested Workflow window;
// otherwise it could expire after source loading but before a paid dispatch.
export const PROVIDER_CONTRACTS_MIN_REMAINING_MS = 5 * 60_000;
export const MONID_CONTROL_PLANE_ORIGIN = "https://api.monid.ai" as const;
export const MONID_INSPECT_PATH = "/v1/inspect" as const;
export const MONID_RUN_PATH = "/v1/run" as const;
export const MONID_RUN_STATUS_PATH_TEMPLATE = "/v1/runs/{run_id}" as const;
export const OPENAI_CONTROL_PLANE_BASE_URL = "https://api.openai.com/v1" as const;

const CanonicalDeploymentUrlSchema = z.string().min(1).transform((value, context) => {
  try {
    const candidate = value.includes("://") ? value : `https://${value}`;
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.search || url.hash || !["", "/"].includes(url.pathname)) {
      throw new Error("invalid deployment URL");
    }
    return url.hostname.toLowerCase();
  } catch {
    context.addIssue({ code: "custom", message: "Invalid Vercel deployment URL." });
    return z.NEVER;
  }
});

const RuntimeIdentitySchema = z.strictObject({
  deployment_id: z.string().regex(/^dpl_[A-Za-z0-9]+$/),
  deployment_url: CanonicalDeploymentUrlSchema,
  project_id: z.string().regex(/^prj_[A-Za-z0-9]+$/),
  team_id: z.string().regex(/^(?:team|user)_[A-Za-z0-9]+$/),
  git_commit_sha: z.string().regex(/^[a-f0-9]{40}$/)
});

export type ProviderContractsRuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;

const ExactConfiguredStringSchema = z.string().min(1).max(512).refine(
  (value) => value === value.trim(),
  "Configured contract values must be canonical."
);

const ArtifactHostnameSchema = z.string().min(1).max(253).refine((hostname) => {
  if (hostname !== hostname.toLowerCase() || hostname.includes("*") || hostname.includes("/")) {
    return false;
  }
  try {
    const url = new URL(`https://${hostname}`);
    return url.hostname === hostname && url.host === hostname && url.pathname === "/" &&
      !url.port && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Artifact hosts must be exact canonical hostnames.");

const CanonicalArtifactHostsSchema = z.array(ArtifactHostnameSchema).min(1).refine(
  (hosts) => stableJson(hosts) === stableJson([...new Set(hosts)].sort()),
  "Artifact hosts must be sorted and unique."
);

export const ProviderContractsConfigurationSchema = z.strictObject({
  monid: z.strictObject({
    api_origin: z.literal(MONID_CONTROL_PLANE_ORIGIN),
    inspect_path: z.literal(MONID_INSPECT_PATH),
    run_path: z.literal(MONID_RUN_PATH),
    run_status_path_template: z.literal(MONID_RUN_STATUS_PATH_TEMPLATE),
    provider: ExactConfiguredStringSchema,
    endpoint: ExactConfiguredStringSchema,
    run_id_path: ExactConfiguredStringSchema,
    run_status_path: ExactConfiguredStringSchema,
    provider_status_path: ExactConfiguredStringSchema,
    result_url_path: ExactConfiguredStringSchema,
    cost_value_path: ExactConfiguredStringSchema,
    cost_currency_path: ExactConfiguredStringSchema,
    cost_value_unit: z.enum(["currency_major", "micro_dollar"]),
    artifact_hosts: CanonicalArtifactHostsSchema,
    inspect_schema_sha256: z.string().regex(/^[a-f0-9]{64}$/)
  }),
  openai: z.strictObject({
    api_base_url: z.literal(OPENAI_CONTROL_PLANE_BASE_URL),
    extraction_model: ExactConfiguredStringSchema,
    qa_model: ExactConfiguredStringSchema,
    checked_models: z.array(ExactConfiguredStringSchema).min(1).refine(
      (models) => stableJson(models) === stableJson([...new Set(models)].sort()),
      "Checked models must be sorted and unique."
    )
  })
});

export type ProviderContractsConfiguration = z.infer<
  typeof ProviderContractsConfigurationSchema
>;

const ProviderCredentialBindingsSchema = z.strictObject({
  monid_hmac_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  openai_hmac_sha256: z.string().regex(/^[a-f0-9]{64}$/)
});

export type ProviderCredentialBindings = z.infer<typeof ProviderCredentialBindingsSchema>;

export const ProviderContractsAttestationPayloadSchema = z.strictObject({
  version: z.literal(PROVIDER_CONTRACTS_ATTESTATION_VERSION),
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  deployment: z.strictObject({
    id: z.string().regex(/^dpl_[A-Za-z0-9]+$/),
    url: CanonicalDeploymentUrlSchema,
    target: z.literal("production"),
    ready_state: z.literal("READY"),
    project: z.strictObject({
      id: z.string().regex(/^prj_[A-Za-z0-9]+$/),
      name: ExactConfiguredStringSchema
    }),
    team: z.strictObject({
      id: z.string().regex(/^(?:team|user)_[A-Za-z0-9]+$/),
      slug: ExactConfiguredStringSchema
    }),
    git_commit_sha: z.string().regex(/^[a-f0-9]{40}$/)
  }),
  contracts: ProviderContractsConfigurationSchema,
  credential_bindings: ProviderCredentialBindingsSchema,
  checks: z.strictObject({
    monid_inspect: z.strictObject({
      status: z.literal("verified_non_paid"),
      canonical_response_sha256: z.string().regex(/^[a-f0-9]{64}$/)
    }),
    openai_models: z.array(z.strictObject({
      model: ExactConfiguredStringSchema,
      status: z.literal("available_non_paid")
    })).min(1)
  })
}).superRefine((payload, context) => {
  if (payload.checks.monid_inspect.canonical_response_sha256 !==
    payload.contracts.monid.inspect_schema_sha256) {
    context.addIssue({
      code: "custom",
      path: ["checks", "monid_inspect", "canonical_response_sha256"],
      message: "The checked Monid response hash must equal the pinned full-response hash."
    });
  }
  const checkedModels = payload.checks.openai_models.map((item) => item.model);
  if (stableJson(checkedModels) !== stableJson(payload.contracts.openai.checked_models)) {
    context.addIssue({
      code: "custom",
      path: ["checks", "openai_models"],
      message: "Every exact configured OpenAI model must have a non-paid availability check."
    });
  }
});

export type ProviderContractsAttestationPayload = z.infer<
  typeof ProviderContractsAttestationPayloadSchema
>;

const ReleaseAttestationRowSchema = z.strictObject({
  kind: z.string(),
  deployment_id: z.string(),
  deployment_url: z.string(),
  project_id: z.string(),
  team_id: z.string(),
  git_commit_sha: z.string(),
  payload: z.unknown(),
  payload_sha256: z.string(),
  issued_at: z.union([z.date(), z.string()]),
  expires_at: z.union([z.date(), z.string()])
});

export type ProviderContractsAttestationHealth =
  | { status: "configured_unattested" }
  | { status: "mismatch" }
  | { status: "expired" }
  | {
      status: "actively_verified";
      deploymentId: string;
      expiresAt: string;
      payloadSha256: string;
      configurationSha256: string;
    };

const PROVIDER_CONTRACTS_CAPABILITY_BRAND: unique symbol = Symbol(
  "provider-contracts-capability"
);

/** In-process proof that this exact deployment/config pair was just validated. */
export interface ProviderContractsCapability {
  readonly [PROVIDER_CONTRACTS_CAPABILITY_BRAND]: true;
  readonly identity: ProviderContractsRuntimeIdentity;
  readonly expiresAt: string;
  readonly configurationSha256: string;
}

export function canonicalArtifactHostAllowlist(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const hosts = raw.split(",").map((item) => item.trim().toLowerCase()).sort();
  const parsed = CanonicalArtifactHostsSchema.safeParse(hosts);
  return parsed.success ? parsed.data : null;
}

export function providerContractsConfiguration(
  config: AppConfig
): ProviderContractsConfiguration | null {
  const artifactHosts = canonicalArtifactHostAllowlist(config.MONID_ARTIFACT_HOST_ALLOWLIST);
  const values = [
    config.MONID_PARSE_PROVIDER,
    config.MONID_PARSE_ENDPOINT,
    config.MONID_RUN_ID_PATH,
    config.MONID_RUN_STATUS_PATH,
    config.MONID_PROVIDER_STATUS_PATH,
    config.MONID_RESULT_URL_PATH,
    config.MONID_COST_VALUE_PATH,
    config.MONID_COST_CURRENCY_PATH,
    config.MONID_COST_VALUE_UNIT,
    config.MONID_INSPECT_SCHEMA_SHA256,
    config.OPENAI_EXTRACTION_MODEL,
    config.OPENAI_QA_MODEL
  ];
  if (values.some((value) => !value) || !artifactHosts) return null;
  let monidOrigin: string;
  try {
    const url = new URL(config.MONID_API_BASE_URL);
    if (url.origin !== MONID_CONTROL_PLANE_ORIGIN || url.pathname !== "/" ||
      url.username || url.password || url.port || url.search || url.hash) {
      return null;
    }
    monidOrigin = url.origin;
  } catch {
    return null;
  }
  const checkedModels = [...new Set([
    config.OPENAI_EXTRACTION_MODEL,
    config.OPENAI_QA_MODEL
  ])].sort();
  const candidate = ProviderContractsConfigurationSchema.safeParse({
    monid: {
      api_origin: monidOrigin,
      inspect_path: MONID_INSPECT_PATH,
      run_path: MONID_RUN_PATH,
      run_status_path_template: MONID_RUN_STATUS_PATH_TEMPLATE,
      provider: config.MONID_PARSE_PROVIDER,
      endpoint: config.MONID_PARSE_ENDPOINT,
      run_id_path: config.MONID_RUN_ID_PATH,
      run_status_path: config.MONID_RUN_STATUS_PATH,
      provider_status_path: config.MONID_PROVIDER_STATUS_PATH,
      result_url_path: config.MONID_RESULT_URL_PATH,
      cost_value_path: config.MONID_COST_VALUE_PATH,
      cost_currency_path: config.MONID_COST_CURRENCY_PATH,
      cost_value_unit: config.MONID_COST_VALUE_UNIT,
      artifact_hosts: artifactHosts,
      inspect_schema_sha256: config.MONID_INSPECT_SCHEMA_SHA256
    },
    openai: {
      api_base_url: OPENAI_CONTROL_PLANE_BASE_URL,
      extraction_model: config.OPENAI_EXTRACTION_MODEL,
      qa_model: config.OPENAI_QA_MODEL,
      checked_models: checkedModels
    }
  });
  return candidate.success ? candidate.data : null;
}

/**
 * Bind the credentials actually installed in this immutable deployment
 * without persisting either key or a reusable raw key hash. The provider key
 * is the HMAC key and the deployment identity is the domain-separated
 * message, so the stored value changes for every deployment.
 */
export function providerCredentialBindings(
  config: AppConfig,
  identity: ProviderContractsRuntimeIdentity
): ProviderCredentialBindings | null {
  if (!config.MONID_API_KEY || !config.OPENAI_API_KEY) return null;
  const base = stableJson({
    kind: PROVIDER_CONTRACTS_ATTESTATION_KIND,
    deployment_id: identity.deployment_id,
    deployment_url: identity.deployment_url,
    project_id: identity.project_id,
    team_id: identity.team_id,
    git_commit_sha: identity.git_commit_sha
  });
  return {
    monid_hmac_sha256: hmacSha256Hex(config.MONID_API_KEY, `${base}\nprovider=monid`),
    openai_hmac_sha256: hmacSha256Hex(config.OPENAI_API_KEY, `${base}\nprovider=openai`)
  };
}

function runtimeIdentity(
  environment: Partial<NodeJS.ProcessEnv>
): ProviderContractsRuntimeIdentity | null {
  if (environment.VERCEL !== "1" || environment.VERCEL_ENV !== "production") return null;
  const parsed = RuntimeIdentitySchema.safeParse({
    deployment_id: environment.VERCEL_DEPLOYMENT_ID,
    deployment_url: environment.VERCEL_URL,
    project_id: environment.VERCEL_PROJECT_ID,
    team_id: environment.RFP_XRAY_VERCEL_TEAM_ID ?? environment.VERCEL_ORG_ID,
    git_commit_sha: environment.VERCEL_GIT_COMMIT_SHA?.toLowerCase()
  });
  return parsed.success ? parsed.data : null;
}

function rowMatchesPayload(
  row: ReleaseAttestationRow,
  payload: ProviderContractsAttestationPayload
) {
  const issuedAt = new Date(row.issued_at);
  const expiresAt = new Date(row.expires_at);
  return row.kind === PROVIDER_CONTRACTS_ATTESTATION_KIND &&
    row.deployment_id === payload.deployment.id &&
    row.deployment_url.toLowerCase() === payload.deployment.url &&
    row.project_id === payload.deployment.project.id &&
    row.team_id === payload.deployment.team.id &&
    row.git_commit_sha.toLowerCase() === payload.deployment.git_commit_sha &&
    Number.isFinite(issuedAt.getTime()) && issuedAt.toISOString() === payload.issued_at &&
    Number.isFinite(expiresAt.getTime()) && expiresAt.toISOString() === payload.expires_at;
}

function payloadMatchesRuntime(
  payload: ProviderContractsAttestationPayload,
  identity: ProviderContractsRuntimeIdentity
) {
  return payload.deployment.id === identity.deployment_id &&
    payload.deployment.url === identity.deployment_url &&
    payload.deployment.project.id === identity.project_id &&
    payload.deployment.team.id === identity.team_id &&
    payload.deployment.git_commit_sha === identity.git_commit_sha;
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("provider attestation probe timed out")), timeoutMs);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Validate one sanitized, deployment-bound provider receipt. The SHA is an
 * integrity binding rather than a signature; release-writer and database
 * access boundaries provide authority. Provider/database details never leave
 * this function through error messages or health output.
 */
export async function probeProviderContractsAttestation(
  databaseUrl: string | undefined,
  config: AppConfig,
  environment: Partial<NodeJS.ProcessEnv> = process.env,
  now = new Date(),
  options: {
    timeoutMs?: number;
    query?: () => Promise<ReleaseAttestationRow[]>;
  } = {}
): Promise<ProviderContractsAttestationHealth> {
  const identity = runtimeIdentity(environment);
  const expectedConfiguration = providerContractsConfiguration(config);
  const expectedCredentialBindings = identity
    ? providerCredentialBindings(config, identity)
    : null;
  if (!databaseUrl || !identity) return { status: "configured_unattested" };
  if (!expectedConfiguration || !expectedCredentialBindings) return { status: "mismatch" };
  try {
    const query = options.query ?? (async () => {
      const { readReleaseAttestation } = await import("@/db/release-attestation-store");
      return readReleaseAttestation(
        databaseUrl,
        PROVIDER_CONTRACTS_ATTESTATION_KIND,
        identity.deployment_id
      );
    });
    const rows = await within(query(), options.timeoutMs ?? 2_500);
    const rawRow = rows[0];
    if (rows.length !== 1 || !rawRow) return { status: "configured_unattested" };
    const parsedRow = ReleaseAttestationRowSchema.safeParse(rawRow);
    if (!parsedRow.success) return { status: "mismatch" };
    const row = parsedRow.data;
    const parsedPayload = ProviderContractsAttestationPayloadSchema.safeParse(row.payload);
    if (!parsedPayload.success || !/^[a-f0-9]{64}$/.test(row.payload_sha256)) {
      return { status: "mismatch" };
    }
    const payload = parsedPayload.data;
    const expectedPayloadSha256 = sha256Hex(stableJson(payload));
    if (!constantTimeHexEqual(row.payload_sha256, expectedPayloadSha256) ||
      !rowMatchesPayload(row, payload)) {
      return { status: "mismatch" };
    }
    const issuedAt = Date.parse(payload.issued_at);
    const expiresAt = Date.parse(payload.expires_at);
    if (issuedAt > now.getTime() + PROVIDER_CONTRACTS_MAX_FUTURE_SKEW_MS ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > PROVIDER_CONTRACTS_ATTESTATION_MAX_AGE_MS) {
      return { status: "mismatch" };
    }
    if (expiresAt <= now.getTime() + PROVIDER_CONTRACTS_MIN_REMAINING_MS) {
      return { status: "expired" };
    }
    if (!payloadMatchesRuntime(payload, identity) ||
      stableJson(payload.contracts) !== stableJson(expectedConfiguration) ||
      !constantTimeHexEqual(
        payload.credential_bindings.monid_hmac_sha256,
        expectedCredentialBindings.monid_hmac_sha256
      ) ||
      !constantTimeHexEqual(
        payload.credential_bindings.openai_hmac_sha256,
        expectedCredentialBindings.openai_hmac_sha256
      )) {
      return { status: "mismatch" };
    }
    const configurationSha256 = sha256Hex(stableJson({
      contracts: expectedConfiguration,
      credential_bindings: expectedCredentialBindings
    }));
    return {
      status: "actively_verified",
      deploymentId: payload.deployment.id,
      expiresAt: payload.expires_at,
      payloadSha256: expectedPayloadSha256,
      configurationSha256
    };
  } catch {
    return { status: "configured_unattested" };
  }
}

export async function assertProviderContractsActivelyVerified(
  config: AppConfig,
  options: {
    environment?: Partial<NodeJS.ProcessEnv>;
    now?: Date;
    probe?: () => Promise<ProviderContractsAttestationHealth>;
    capability?: ProviderContractsCapability;
  } = {}
): Promise<ProviderContractsCapability | null> {
  if (config.NODE_ENV !== "production") return null;
  const environment = options.environment ?? process.env;
  const now = options.now ?? new Date();
  const identity = runtimeIdentity(environment);
  const configuration = providerContractsConfiguration(config);
  const credentialBindings = identity ? providerCredentialBindings(config, identity) : null;
  if (!identity || !configuration || !credentialBindings) {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      "The production provider contracts are configured unattested.",
      { httpStatus: 503, retryable: true }
    );
  }
  const configurationSha256 = sha256Hex(stableJson({
    contracts: configuration,
    credential_bindings: credentialBindings
  }));
  let health: ProviderContractsAttestationHealth;
  if (options.capability) {
    const validCapability = options.capability[PROVIDER_CONTRACTS_CAPABILITY_BRAND] === true &&
      stableJson(options.capability.identity) === stableJson(identity) &&
      constantTimeHexEqual(options.capability.configurationSha256, configurationSha256);
    health = !validCapability
      ? { status: "mismatch" }
      : !Number.isFinite(Date.parse(options.capability.expiresAt)) ||
          Date.parse(options.capability.expiresAt) <=
            now.getTime() + PROVIDER_CONTRACTS_MIN_REMAINING_MS
        ? { status: "expired" }
        : {
            status: "actively_verified",
            deploymentId: identity.deployment_id,
            expiresAt: options.capability.expiresAt,
            payloadSha256: "capability_reuse",
            configurationSha256
          };
  } else {
    health = options.probe
      ? await options.probe()
      : await probeProviderContractsAttestation(config.DATABASE_URL, config, environment, now);
  }
  if (!options.capability && health.status === "actively_verified") {
    if (health.deploymentId !== identity.deployment_id ||
      !/^[a-f0-9]{64}$/.test(health.payloadSha256) ||
      !constantTimeHexEqual(health.configurationSha256, configurationSha256) ||
      !Number.isFinite(Date.parse(health.expiresAt))) {
      health = { status: "mismatch" };
    } else if (Date.parse(health.expiresAt) <=
      now.getTime() + PROVIDER_CONTRACTS_MIN_REMAINING_MS) {
      health = { status: "expired" };
    }
  }
  if (health.status !== "actively_verified") {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      `The production provider contracts are ${health.status.replaceAll("_", " ")}.`,
      { httpStatus: 503, retryable: true }
    );
  }
  return options.capability ?? {
    [PROVIDER_CONTRACTS_CAPABILITY_BRAND]: true,
    identity,
    expiresAt: health.expiresAt,
    configurationSha256
  };
}
