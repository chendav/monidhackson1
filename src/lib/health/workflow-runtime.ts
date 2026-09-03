import { z } from "zod";
import type { AppConfig } from "@/lib/config";
import { constantTimeHexEqual, sha256Hex, stableJson } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import type { ReleaseAttestationRow } from "@/db/release-attestation-store";

export type { ReleaseAttestationRow } from "@/db/release-attestation-store";

export const WORKFLOW_RUNTIME_ATTESTATION_KIND = "vercel_workflow_runtime/v1" as const;
export const WORKFLOW_RUNTIME_ATTESTATION_VERSION = 1 as const;
export const WORKFLOW_RUNTIME_REQUIRED_TIMEOUT_SECONDS = 300;
export const WORKFLOW_RUNTIME_ATTESTATION_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const WORKFLOW_RUNTIME_MAX_FUTURE_SKEW_MS = 60_000;
export const WORKFLOW_PACKAGE_VERSION = "4.8.5" as const;
export const WORKFLOW_NODE_RUNTIME = "nodejs22.x" as const;
export const WORKFLOW_MIN_MEMORY_MB = 2048;

/**
 * These values are part of the release attestation, not operator-tunable
 * configuration. The pipeline imports them so a code change invalidates an
 * older deployment receipt instead of silently widening its runtime budget.
 */
export const WORKFLOW_INTERNAL_DEADLINES_MS = {
  live_network: 105_000,
  pre_model: 150_000,
  result_commit: 285_000
} as const;

export const WORKFLOW_RUNTIME_ROUTES = {
  flow: ".well-known/workflow/v1/flow",
  step: ".well-known/workflow/v1/step"
} as const;

const CanonicalRegionsSchema = z.array(z.string().regex(/^[a-z]{3}\d$/)).min(1).refine(
  (regions) => stableJson(regions) === stableJson([...new Set(regions)].sort()),
  "Workflow regions must be sorted and unique."
);

const WorkflowRouteFunctionSchema = z.strictObject({
  timeout_seconds: z.number().int().min(WORKFLOW_RUNTIME_REQUIRED_TIMEOUT_SECONDS),
  node_runtime: z.literal(WORKFLOW_NODE_RUNTIME),
  memory_mb: z.number().int().min(WORKFLOW_MIN_MEMORY_MB),
  regions: CanonicalRegionsSchema
});

const DeploymentUrlSchema = z.string().min(1).transform((value, context) => {
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
  deployment_url: DeploymentUrlSchema,
  project_id: z.string().regex(/^prj_[A-Za-z0-9]+$/),
  team_id: z.string().regex(/^(?:team|user)_[A-Za-z0-9]+$/),
  git_commit_sha: z.string().regex(/^[a-f0-9]{40}$/)
});

export type WorkflowRuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;

export const WorkflowRuntimeAttestationPayloadSchema = z.strictObject({
  version: z.literal(WORKFLOW_RUNTIME_ATTESTATION_VERSION),
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  deployment: z.strictObject({
    id: z.string().regex(/^dpl_[A-Za-z0-9]+$/),
    url: DeploymentUrlSchema,
    target: z.literal("production"),
    ready_state: z.literal("READY"),
    project: z.strictObject({
      id: z.string().regex(/^prj_[A-Za-z0-9]+$/),
      name: z.string().min(1)
    }),
    team: z.strictObject({
      id: z.string().regex(/^(?:team|user)_[A-Za-z0-9]+$/),
      slug: z.string().min(1)
    }),
    git_commit_sha: z.string().regex(/^[a-f0-9]{40}$/)
  }),
  workflow: z.strictObject({
    package_version: z.literal(WORKFLOW_PACKAGE_VERSION),
    required_min_timeout_seconds: z.literal(WORKFLOW_RUNTIME_REQUIRED_TIMEOUT_SECONDS),
    analysis_step_max_duration_seconds: z.literal(WORKFLOW_RUNTIME_REQUIRED_TIMEOUT_SECONDS),
    route_functions: z.strictObject({
      [WORKFLOW_RUNTIME_ROUTES.flow]: WorkflowRouteFunctionSchema,
      [WORKFLOW_RUNTIME_ROUTES.step]: WorkflowRouteFunctionSchema
    }),
    internal_deadlines_ms: z.strictObject({
      live_network: z.literal(WORKFLOW_INTERNAL_DEADLINES_MS.live_network),
      pre_model: z.literal(WORKFLOW_INTERNAL_DEADLINES_MS.pre_model),
      result_commit: z.literal(WORKFLOW_INTERNAL_DEADLINES_MS.result_commit)
    })
  })
});

export type WorkflowRuntimeAttestationPayload = z.infer<
  typeof WorkflowRuntimeAttestationPayloadSchema
>;

const ReleaseAttestationRowSchema = z.object({
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

export type WorkflowRuntimeAttestationHealth =
  | { status: "configured_unattested" }
  | { status: "mismatch" }
  | { status: "expired" }
  | {
      status: "attested_300s";
      deploymentId: string;
      expiresAt: string;
      payloadSha256: string;
    };

const WORKFLOW_RUNTIME_CAPABILITY_BRAND: unique symbol = Symbol("workflow-runtime-capability");

/** In-process capability created only after an exact receipt validation. */
export interface WorkflowRuntimeCapability {
  readonly [WORKFLOW_RUNTIME_CAPABILITY_BRAND]: true;
  readonly identity: WorkflowRuntimeIdentity;
  readonly expiresAt: string;
}

function runtimeIdentity(
  environment: Partial<NodeJS.ProcessEnv>
): WorkflowRuntimeIdentity | null {
  if (environment.VERCEL !== "1" || environment.VERCEL_ENV !== "production") return null;
  const parsed = RuntimeIdentitySchema.safeParse({
    deployment_id: environment.VERCEL_DEPLOYMENT_ID,
    deployment_url: environment.VERCEL_URL,
    project_id: environment.VERCEL_PROJECT_ID,
    // Vercel exposes deployment and project IDs at runtime, but not the
    // owning team ID. Bind that non-secret ID explicitly at deploy time.
    team_id: environment.RFP_XRAY_VERCEL_TEAM_ID ?? environment.VERCEL_ORG_ID,
    git_commit_sha: environment.VERCEL_GIT_COMMIT_SHA?.toLowerCase()
  });
  return parsed.success ? parsed.data : null;
}

function rowMatchesPayload(
  row: ReleaseAttestationRow,
  payload: WorkflowRuntimeAttestationPayload
) {
  const issuedAt = new Date(row.issued_at);
  const expiresAt = new Date(row.expires_at);
  return row.kind === WORKFLOW_RUNTIME_ATTESTATION_KIND &&
    row.deployment_id === payload.deployment.id &&
    row.deployment_url.toLowerCase() === payload.deployment.url &&
    row.project_id === payload.deployment.project.id &&
    row.team_id === payload.deployment.team.id &&
    row.git_commit_sha.toLowerCase() === payload.deployment.git_commit_sha &&
    Number.isFinite(issuedAt.getTime()) && issuedAt.toISOString() === payload.issued_at &&
    Number.isFinite(expiresAt.getTime()) && expiresAt.toISOString() === payload.expires_at;
}

function payloadMatchesRuntime(
  payload: WorkflowRuntimeAttestationPayload,
  identity: WorkflowRuntimeIdentity
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
        timer = setTimeout(() => reject(new Error("release attestation probe timed out")), timeoutMs);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Validate a non-secret, deployment-bound release receipt. Database and
 * provider errors collapse to `configured_unattested`; neither raw rows nor
 * connection details are exposed to health responses or logs. The SHA-256 is
 * an integrity/corruption binding, not authentication; authority comes from
 * the separately controlled release writer and database access boundary.
 */
export async function probeWorkflowRuntimeAttestation(
  databaseUrl: string | undefined,
  environment: Partial<NodeJS.ProcessEnv> = process.env,
  now = new Date(),
  options: {
    timeoutMs?: number;
    query?: () => Promise<ReleaseAttestationRow[]>;
  } = {}
): Promise<WorkflowRuntimeAttestationHealth> {
  const identity = runtimeIdentity(environment);
  if (!databaseUrl || !identity) return { status: "configured_unattested" };
  try {
    const query = options.query ?? (async () => {
      const { readReleaseAttestation } = await import("@/db/release-attestation-store");
      return readReleaseAttestation(
        databaseUrl,
        WORKFLOW_RUNTIME_ATTESTATION_KIND,
        identity.deployment_id
      );
    });
    const rows = await within(query(), options.timeoutMs ?? 2_500);
    const rawRow = rows[0];
    if (rows.length !== 1 || !rawRow) return { status: "configured_unattested" };
    const parsedRow = ReleaseAttestationRowSchema.safeParse(rawRow);
    if (!parsedRow.success) return { status: "mismatch" };
    const row = parsedRow.data;
    const parsed = WorkflowRuntimeAttestationPayloadSchema.safeParse(row.payload);
    if (!parsed.success || !/^[a-f0-9]{64}$/.test(row.payload_sha256)) {
      return { status: "mismatch" };
    }
    const payload = parsed.data;
    const expectedSha256 = sha256Hex(stableJson(payload));
    if (!constantTimeHexEqual(row.payload_sha256, expectedSha256) ||
      !rowMatchesPayload(row, payload)) {
      return { status: "mismatch" };
    }
    const issuedAt = Date.parse(payload.issued_at);
    const expiresAt = Date.parse(payload.expires_at);
    if (issuedAt > now.getTime() + WORKFLOW_RUNTIME_MAX_FUTURE_SKEW_MS ||
      expiresAt <= issuedAt || expiresAt - issuedAt > WORKFLOW_RUNTIME_ATTESTATION_MAX_AGE_MS) {
      return { status: "mismatch" };
    }
    if (expiresAt <= now.getTime()) return { status: "expired" };
    if (!payloadMatchesRuntime(payload, identity)) return { status: "mismatch" };
    return {
      status: "attested_300s",
      deploymentId: payload.deployment.id,
      expiresAt: payload.expires_at,
      payloadSha256: expectedSha256
    };
  } catch {
    return { status: "configured_unattested" };
  }
}

export async function assertWorkflowRuntimeAttested(
  config: AppConfig,
  options: {
    environment?: Partial<NodeJS.ProcessEnv>;
    now?: Date;
    probe?: () => Promise<WorkflowRuntimeAttestationHealth>;
    capability?: WorkflowRuntimeCapability;
  } = {}
): Promise<WorkflowRuntimeCapability | null> {
  if (config.NODE_ENV !== "production") return null;
  const environment = options.environment ?? process.env;
  const now = options.now ?? new Date();
  const identity = runtimeIdentity(environment);
  if (!identity) {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      "The production Workflow runtime is configured unattested.",
      { httpStatus: 503, retryable: true }
    );
  }
  let health: WorkflowRuntimeAttestationHealth;
  if (options.capability) {
    const validCapability = options.capability[WORKFLOW_RUNTIME_CAPABILITY_BRAND] === true &&
      stableJson(options.capability.identity) === stableJson(identity);
    health = !validCapability
      ? { status: "mismatch" }
      : Date.parse(options.capability.expiresAt) <= now.getTime()
        ? { status: "expired" }
        : {
            status: "attested_300s",
            deploymentId: identity.deployment_id,
            expiresAt: options.capability.expiresAt,
            payloadSha256: "capability_reuse"
          };
  } else {
    health = options.probe
      ? await options.probe()
      : await probeWorkflowRuntimeAttestation(config.DATABASE_URL, environment, now);
  }
  if (!options.capability && health.status === "attested_300s") {
    if (health.deploymentId !== identity.deployment_id ||
      !/^[a-f0-9]{64}$/.test(health.payloadSha256) ||
      !Number.isFinite(Date.parse(health.expiresAt))) {
      health = { status: "mismatch" };
    } else if (Date.parse(health.expiresAt) <= now.getTime()) {
      health = { status: "expired" };
    }
  }
  if (health.status !== "attested_300s") {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      `The production Workflow runtime is ${health.status.replaceAll("_", " ")}.`,
      { httpStatus: 503, retryable: true }
    );
  }
  return options.capability ?? {
    [WORKFLOW_RUNTIME_CAPABILITY_BRAND]: true,
    identity,
    expiresAt: health.expiresAt
  };
}
