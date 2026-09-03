import { z } from "zod";
import {
  canonicalRailwayS3CorsOrigins,
  isRailwayManagedS3Endpoint,
  inspectRailwayS3SafetyAttestation,
  type RailwayS3SafetyStatus
} from "@/lib/storage/railway-s3-safety";

const OptionalUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional()
);

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).optional(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  BLOB_STORE_ID: z.string().min(1).optional(),
  BLOB_REPLAY_FENCE_VALIDATED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  S3_ENDPOINT: OptionalUrlSchema,
  S3_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_URL_STYLE: z.enum(["virtual-host", "path"]).default("virtual-host"),
  S3_CORS_ALLOWED_ORIGINS: z.string().min(1).optional(),
  S3_SAFETY_ATTESTATION: z.string().min(1).optional(),
  // Deprecated compatibility input. A free boolean is never authoritative for
  // Railway storage readiness; only S3_SAFETY_ATTESTATION is checked.
  S3_REPLAY_FENCE_VALIDATED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  MONID_API_KEY: z.string().min(1).optional(),
  MONID_API_BASE_URL: OptionalUrlSchema.default("https://api.monid.ai"),
  MONID_PARSE_SLUG: z.string().min(1).optional(),
  MONID_PARSE_PROVIDER: z.string().min(1).optional(),
  MONID_PARSE_ENDPOINT: z.string().min(1).optional(),
  MONID_RESULT_URL_PATH: z.string().min(1).optional(),
  MONID_RUN_ID_PATH: z.string().min(1).optional(),
  MONID_RUN_STATUS_PATH: z.string().min(1).optional(),
  MONID_PROVIDER_STATUS_PATH: z.string().min(1).optional(),
  MONID_COST_VALUE_PATH: z.string().min(1).optional(),
  MONID_COST_CURRENCY_PATH: z.string().min(1).optional(),
  MONID_COST_VALUE_UNIT: z.enum(["currency_major", "micro_dollar"]).optional(),
  MONID_INSPECT_SCHEMA_SHA256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  MONID_ARTIFACT_HOST_ALLOWLIST: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_EXTRACTION_MODEL: z.literal("gpt-5.4-mini").default("gpt-5.4-mini"),
  OPENAI_QA_MODEL: z.literal("gpt-5.4-mini").default("gpt-5.4-mini"),
  OPENAI_MAX_SERIALIZED_INPUT_BYTES: z.coerce.number().int().positive().max(1_200_000).default(1_200_000),
  OPENAI_MAX_REQUEST_INPUT_BYTES: z.coerce.number().int().positive().max(140_000).default(140_000),
  OPENAI_MAX_INPUT_TOKENS: z.coerce.number().int().positive().max(320_000).default(320_000),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(50_000).default(50_000),
  SESSION_SIGNING_SECRET: z.string().min(32).optional(),
  IP_HASH_SECRET: z.string().min(16).optional(),
  API_KEY_SHA256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  TURNSTILE_EXPECTED_HOSTNAME: z.string().min(1).optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  NEXT_PUBLIC_APP_ORIGIN: OptionalUrlSchema.default("http://localhost:3000"),
  MAX_RUN_COST_MICRO_USD: z.coerce.number().int().positive().default(2_000_000),
  DAILY_COST_CAP_MICRO_USD: z.coerce.number().int().positive().default(20_000_000),
  OPENAI_RUN_RESERVE_MICRO_USD: z.coerce.number().int().nonnegative().max(500_000).default(495_000),
  MONID_PARSE_RESERVE_MICRO_USD: z.coerce.number().int().nonnegative().default(4_500),
  RUN_TTL_HOURS: z.coerce.number().int().positive().max(168).default(24),
  GUEST_RUNS_PER_DAY: z.coerce.number().int().positive().default(3),
  API_RUNS_PER_DAY: z.coerce.number().int().positive().default(30),
  MAX_OUTSTANDING_UPLOAD_GRANTS: z.coerce.number().int().positive().max(20).default(5),
  GUEST_UPLOAD_DOCUMENTS_PER_DAY: z.coerce.number().int().positive().default(15),
  API_UPLOAD_DOCUMENTS_PER_DAY: z.coerce.number().int().positive().default(150),
  GUEST_UPLOAD_BYTES_PER_DAY: z.coerce.number().int().positive().default(375 * 1024 * 1024),
  API_UPLOAD_BYTES_PER_DAY: z.coerce.number().int().positive().default(3_750 * 1024 * 1024),
  GLOBAL_UPLOAD_BYTES_PER_DAY: z.coerce.number().int().positive().default(5 * 1024 * 1024 * 1024)
});

export type AppConfig = z.infer<typeof EnvironmentSchema>;

let cachedConfig: AppConfig | undefined;
const PRODUCTION_MONID_ORIGIN = "https://api.monid.ai";

export function getConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  if (Object.keys(overrides).length > 0) {
    return EnvironmentSchema.parse({ ...process.env, ...overrides });
  }

  cachedConfig ??= EnvironmentSchema.parse(process.env);
  return cachedConfig;
}

export function resetConfigForTests() {
  cachedConfig = undefined;
}

export function hasPinnedMonidApiOrigin(config = getConfig()) {
  try {
    const url = new URL(config.MONID_API_BASE_URL);
    return url.origin === PRODUCTION_MONID_ORIGIN && url.pathname === "/" &&
      !url.username && !url.password && !url.port && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function hasLivePipelineConfig(config = getConfig()) {
  return Boolean(
    config.MONID_API_KEY &&
      config.MONID_PARSE_PROVIDER &&
      config.MONID_PARSE_ENDPOINT &&
      config.MONID_RUN_ID_PATH &&
      config.MONID_RUN_STATUS_PATH &&
      config.MONID_PROVIDER_STATUS_PATH &&
      config.MONID_RESULT_URL_PATH &&
      config.MONID_COST_VALUE_PATH &&
      config.MONID_COST_CURRENCY_PATH &&
      config.MONID_COST_VALUE_UNIT &&
      config.MONID_INSPECT_SCHEMA_SHA256 &&
      config.MONID_ARTIFACT_HOST_ALLOWLIST &&
      config.OPENAI_API_KEY &&
      (config.NODE_ENV !== "production" || hasPinnedMonidApiOrigin(config))
  );
}

export interface ProductionReadiness {
  ready: boolean;
  missing: string[];
}

export function hasPrivateBlobConfig(
  config = getConfig(),
  environment: Partial<NodeJS.ProcessEnv> = process.env
) {
  return Boolean(
    config.BLOB_READ_WRITE_TOKEN || (environment.VERCEL_OIDC_TOKEN && config.BLOB_STORE_ID)
  );
}

export function hasRailwayS3Config(config = getConfig()) {
  return Boolean(
    config.S3_ENDPOINT &&
      config.S3_REGION &&
      config.S3_BUCKET &&
      config.S3_ACCESS_KEY_ID &&
      config.S3_SECRET_ACCESS_KEY
  );
}

export function getRailwayS3CorsAllowedOrigins(config = getConfig()) {
  if (!config.S3_CORS_ALLOWED_ORIGINS) return [];
  return canonicalRailwayS3CorsOrigins(
    config.S3_CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  );
}

export function getRailwayS3SafetyStatus(
  config = getConfig(),
  now = new Date()
): RailwayS3SafetyStatus {
  if (!hasRailwayS3Config(config)) return { valid: false, reason: "missing" };
  if (!isRailwayManagedS3Endpoint(config.S3_ENDPOINT!)) {
    return { valid: false, reason: "target_mismatch" };
  }
  let origins: string[];
  try {
    origins = getRailwayS3CorsAllowedOrigins(config);
    const applicationOrigin = canonicalRailwayS3CorsOrigins([config.NEXT_PUBLIC_APP_ORIGIN])[0];
    if (!origins.includes(applicationOrigin)) return { valid: false, reason: "cors_origin_mismatch" };
  } catch {
    return { valid: false, reason: "cors_origin_mismatch" };
  }
  return inspectRailwayS3SafetyAttestation(config.S3_SAFETY_ATTESTATION, {
    endpoint: config.S3_ENDPOINT!,
    region: config.S3_REGION!,
    bucket: config.S3_BUCKET!,
    forcePathStyle: config.S3_URL_STYLE === "path"
  }, origins, now);
}

/** Compatibility-free public name used by health/release tooling. */
export const getRailwayS3AttestationStatus = getRailwayS3SafetyStatus;

export type PrivateStorageProvider = "railway_s3" | "vercel_blob" | null;

export function getPrivateStorageProvider(
  config = getConfig(),
  environment: Partial<NodeJS.ProcessEnv> = process.env
): PrivateStorageProvider {
  if (hasRailwayS3Config(config)) return "railway_s3";
  // The legacy Blob replay flag is not bound to a store, CORS policy, or
  // expiry. Keep the adapter available for local/test compatibility, but do
  // not let it satisfy the production privacy gate without an equivalent
  // structured attestation.
  if (config.NODE_ENV !== "production" && hasPrivateBlobConfig(config, environment)) {
    return "vercel_blob";
  }
  return null;
}

/**
 * Production is deliberately closed unless every privacy, persistence, abuse,
 * and provider dependency is explicitly configured. Local fallbacks are only
 * available in development and test.
 */
export function getProductionReadiness(
  config = getConfig(),
  environment: Partial<NodeJS.ProcessEnv> = process.env,
  now = new Date()
): ProductionReadiness {
  if (config.NODE_ENV !== "production") return { ready: true, missing: [] };
  const privateStorageProvider = getPrivateStorageProvider(config, environment);
  const storageSafetyValidated = privateStorageProvider === "railway_s3"
    ? getRailwayS3SafetyStatus(config, now).valid
    : false;
  const publicOrigin = new URL(config.NEXT_PUBLIC_APP_ORIGIN);
  const hasPublicOrigin = publicOrigin.protocol === "https:"
    && publicOrigin.hostname !== "localhost";
  const checks: Array<[string, unknown]> = [
    ["DATABASE_URL", config.DATABASE_URL],
    ["PRIVATE_STORAGE", privateStorageProvider],
    ["PRIVATE_STORAGE_SAFETY_ATTESTATION", storageSafetyValidated],
    ["VERCEL_WORKFLOW", environment.VERCEL],
    ["MONID_API_KEY", config.MONID_API_KEY],
    ["MONID_API_BASE_URL", hasPinnedMonidApiOrigin(config)],
    ["MONID_PARSE_PROVIDER", config.MONID_PARSE_PROVIDER],
    ["MONID_PARSE_ENDPOINT", config.MONID_PARSE_ENDPOINT],
    ["MONID_RUN_ID_PATH", config.MONID_RUN_ID_PATH],
    ["MONID_RUN_STATUS_PATH", config.MONID_RUN_STATUS_PATH],
    ["MONID_PROVIDER_STATUS_PATH", config.MONID_PROVIDER_STATUS_PATH],
    ["MONID_RESULT_URL_PATH", config.MONID_RESULT_URL_PATH],
    ["MONID_COST_VALUE_PATH", config.MONID_COST_VALUE_PATH],
    ["MONID_COST_CURRENCY_PATH", config.MONID_COST_CURRENCY_PATH],
    ["MONID_COST_VALUE_UNIT", config.MONID_COST_VALUE_UNIT],
    ["MONID_INSPECT_SCHEMA_SHA256", config.MONID_INSPECT_SCHEMA_SHA256],
    ["MONID_ARTIFACT_HOST_ALLOWLIST", config.MONID_ARTIFACT_HOST_ALLOWLIST],
    ["OPENAI_API_KEY", config.OPENAI_API_KEY],
    ["SESSION_SIGNING_SECRET", config.SESSION_SIGNING_SECRET],
    ["IP_HASH_SECRET", config.IP_HASH_SECRET],
    ["TURNSTILE_SECRET_KEY", config.TURNSTILE_SECRET_KEY],
    ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", config.NEXT_PUBLIC_TURNSTILE_SITE_KEY],
    ["TURNSTILE_EXPECTED_HOSTNAME", config.TURNSTILE_EXPECTED_HOSTNAME],
    ["CRON_SECRET", config.CRON_SECRET],
    ["API_KEY_SHA256", config.API_KEY_SHA256],
    ["NEXT_PUBLIC_APP_ORIGIN", hasPublicOrigin]
  ];
  const missing = checks.filter(([, value]) => !value).map(([name]) => name);
  return { ready: missing.length === 0, missing };
}
