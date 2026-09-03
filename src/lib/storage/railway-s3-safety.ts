import { z } from "zod";
import { sha256Hex, stableJson } from "@/lib/crypto";

export const RAILWAY_S3_SAFETY_ATTESTATION_VERSION = "rfp-xray-railway-s3-safety/v1" as const;
export const RAILWAY_S3_SAFETY_ATTESTATION_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

const REPLAY_CONTRACT = "signed-if-none-match_put+if-match_zero-fence+conditional-delete/v1" as const;
const CORS_CONTRACT = "browser-put+get/v1" as const;

const CanonicalTargetSchema = z.strictObject({
  endpoint: z.url(),
  region: z.string().min(1),
  bucket: z.string().min(1),
  url_style: z.enum(["virtual-host", "path"])
});

const CorsRuleSchema = z.strictObject({
  allowed_origins: z.array(z.string().min(1)),
  allowed_methods: z.array(z.string().min(1)),
  allowed_headers: z.array(z.string().min(1)),
  exposed_headers: z.array(z.string().min(1)),
  max_age_seconds: z.number().int().nonnegative().nullable()
});

const AttestationPayloadSchema = z.strictObject({
  version: z.literal(RAILWAY_S3_SAFETY_ATTESTATION_VERSION),
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  target: CanonicalTargetSchema,
  controls: z.strictObject({
    bucket_versioning: z.literal("never_enabled"),
    object_lock: z.enum(["absent", "disabled"]),
    object_versions: z.enum(["verified_empty", "listing_unsupported"]),
    replay_contract: z.literal(REPLAY_CONTRACT),
    cors_contract: z.literal(CORS_CONTRACT),
    cors_expected_origins: z.array(z.url()).min(1),
    cors_rules: z.array(CorsRuleSchema).min(1)
  })
});

const AttestationEnvelopeSchema = z.strictObject({
  payload: AttestationPayloadSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/)
});

export type RailwayS3CanonicalTarget = z.infer<typeof CanonicalTargetSchema>;
export type RailwayS3CorsRule = z.infer<typeof CorsRuleSchema>;
export type RailwayS3SafetyAttestationPayload = z.infer<typeof AttestationPayloadSchema>;

export interface RailwayS3SafetyTargetInput {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle?: boolean;
}

export type RailwayS3SafetyStatus =
  | { valid: true; fingerprint: string; expiresAt: string }
  | {
      valid: false;
      reason: "missing" | "malformed" | "fingerprint_mismatch" | "target_mismatch" |
        "cors_origin_mismatch" | "contract_mismatch" | "not_yet_valid" | "expired" | "lifetime_too_long";
    };

function canonicalUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("S3 safety targets require a credential-free HTTPS endpoint without query or fragment data.");
  }
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

/**
 * Railway Bucket credentials are scoped to Railway's managed S3 gateway. A
 * credential-bearing production client must never accept an operator supplied
 * lookalike or generic HTTPS endpoint because that would turn configuration
 * drift into secret exfiltration.
 */
export function isRailwayManagedS3Endpoint(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.port && !url.search && !url.hash &&
      (url.pathname === "/" || url.pathname === "") &&
      hostname.endsWith(".storageapi.dev") &&
      hostname.length > ".storageapi.dev".length;
  } catch {
    return false;
  }
}

function canonicalOrigin(value: string) {
  const url = new URL(value);
  if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password ||
    url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("CORS origins must be bare HTTP(S) origins.");
  }
  return url.origin.toLowerCase();
}

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function canonicalRailwayS3Target(input: RailwayS3SafetyTargetInput): RailwayS3CanonicalTarget {
  return {
    endpoint: canonicalUrl(input.endpoint),
    region: input.region.trim().toLowerCase(),
    bucket: input.bucket.trim(),
    url_style: input.forcePathStyle ? "path" : "virtual-host"
  };
}

export function canonicalRailwayS3CorsOrigins(origins: readonly string[]) {
  return sortedUnique(origins.map(canonicalOrigin));
}

export function canonicalRailwayS3CorsRules(rules: readonly RailwayS3CorsRule[]) {
  return [...rules].map((rule) => ({
    allowed_origins: sortedUnique(rule.allowed_origins.map((origin) => origin === "*" ? origin : canonicalOrigin(origin))),
    allowed_methods: sortedUnique(rule.allowed_methods.map((method) => method.trim().toUpperCase())),
    allowed_headers: sortedUnique(rule.allowed_headers.map((header) => header.trim().toLowerCase())),
    exposed_headers: sortedUnique(rule.exposed_headers.map((header) => header.trim().toLowerCase())),
    max_age_seconds: rule.max_age_seconds
  })).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

export function verifyRailwayS3CorsContract(
  rawRules: readonly RailwayS3CorsRule[],
  rawExpectedOrigins: readonly string[]
) {
  const rules = canonicalRailwayS3CorsRules(rawRules);
  const expected = canonicalRailwayS3CorsOrigins(rawExpectedOrigins);
  if (expected.length === 0) throw new Error("The S3 safety contract requires explicit CORS origins.");
  if (rules.some((rule) =>
    rule.allowed_origins.includes("*") || rule.allowed_headers.includes("*") ||
    rule.allowed_methods.some((method) => !["GET", "HEAD", "PUT"].includes(method))
  )) {
    throw new Error("The Bucket CORS policy contains a wildcard or an unsafe method.");
  }
  const actualOrigins = sortedUnique(rules.flatMap((rule) => rule.allowed_origins));
  if (stableJson(actualOrigins) !== stableJson(expected)) {
    throw new Error("The Bucket CORS origins do not exactly match the attested origins.");
  }
  for (const origin of expected) {
    const applicable = rules.filter((rule) => rule.allowed_origins.includes(origin));
    const methods = new Set(applicable.flatMap((rule) => rule.allowed_methods));
    const headers = new Set(applicable.flatMap((rule) => rule.allowed_headers));
    const exposed = new Set(applicable.flatMap((rule) => rule.exposed_headers));
    for (const method of ["GET", "HEAD", "PUT"]) {
      if (!methods.has(method)) throw new Error(`The Bucket CORS policy omits ${method} for an attested origin.`);
    }
    // Content-Length remains signed, but a browser controls it and does not
    // include it in Access-Control-Request-Headers.
    for (const header of ["content-type", "if-none-match"]) {
      if (!headers.has(header)) throw new Error(`The Bucket CORS policy omits ${header} for an attested origin.`);
    }
    if (!exposed.has("etag")) throw new Error("The Bucket CORS policy does not expose ETag.");
  }
  return rules;
}

export function createRailwayS3SafetyAttestation(input: {
  target: RailwayS3SafetyTargetInput;
  issuedAt: Date;
  expiresAt: Date;
  objectLock: "absent" | "disabled";
  objectVersions: "verified_empty" | "listing_unsupported";
  corsExpectedOrigins: readonly string[];
  corsRules: readonly RailwayS3CorsRule[];
}) {
  const corsExpectedOrigins = canonicalRailwayS3CorsOrigins(input.corsExpectedOrigins);
  const corsRules = verifyRailwayS3CorsContract(input.corsRules, corsExpectedOrigins);
  const payload: RailwayS3SafetyAttestationPayload = {
    version: RAILWAY_S3_SAFETY_ATTESTATION_VERSION,
    issued_at: input.issuedAt.toISOString(),
    expires_at: input.expiresAt.toISOString(),
    target: canonicalRailwayS3Target(input.target),
    controls: {
      bucket_versioning: "never_enabled",
      object_lock: input.objectLock,
      object_versions: input.objectVersions,
      replay_contract: REPLAY_CONTRACT,
      cors_contract: CORS_CONTRACT,
      cors_expected_origins: corsExpectedOrigins,
      cors_rules: corsRules
    }
  };
  const fingerprint = sha256Hex(stableJson(payload));
  return Buffer.from(stableJson({ payload, fingerprint }), "utf8").toString("base64url");
}

export function inspectRailwayS3SafetyAttestation(
  encoded: string | undefined,
  expectedTarget: RailwayS3SafetyTargetInput,
  expectedCorsOrigins: readonly string[],
  now = new Date()
): RailwayS3SafetyStatus {
  if (!encoded) return { valid: false, reason: "missing" };
  let envelope: z.infer<typeof AttestationEnvelopeSchema>;
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    envelope = AttestationEnvelopeSchema.parse(JSON.parse(decoded));
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (sha256Hex(stableJson(envelope.payload)) !== envelope.fingerprint) {
    return { valid: false, reason: "fingerprint_mismatch" };
  }
  let target: RailwayS3CanonicalTarget;
  let origins: string[];
  try {
    target = canonicalRailwayS3Target(expectedTarget);
    origins = canonicalRailwayS3CorsOrigins(expectedCorsOrigins);
  } catch {
    return { valid: false, reason: "target_mismatch" };
  }
  if (stableJson(envelope.payload.target) !== stableJson(target)) {
    return { valid: false, reason: "target_mismatch" };
  }
  if (stableJson(envelope.payload.controls.cors_expected_origins) !== stableJson(origins)) {
    return { valid: false, reason: "cors_origin_mismatch" };
  }
  try {
    verifyRailwayS3CorsContract(envelope.payload.controls.cors_rules, origins);
  } catch {
    return { valid: false, reason: "contract_mismatch" };
  }
  const issuedAt = Date.parse(envelope.payload.issued_at);
  const expiresAt = Date.parse(envelope.payload.expires_at);
  if (issuedAt > now.getTime() + 60_000) return { valid: false, reason: "not_yet_valid" };
  if (expiresAt <= now.getTime()) return { valid: false, reason: "expired" };
  if (expiresAt <= issuedAt || expiresAt - issuedAt > RAILWAY_S3_SAFETY_ATTESTATION_MAX_AGE_MS) {
    return { valid: false, reason: "lifetime_too_long" };
  }
  return { valid: true, fingerprint: envelope.fingerprint, expiresAt: envelope.payload.expires_at };
}
