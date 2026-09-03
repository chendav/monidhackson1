import { describe, expect, it } from "vitest";
import {
  getConfig,
  getPrivateStorageProvider,
  getProductionReadiness,
  getRailwayS3SafetyStatus,
  hasPrivateBlobConfig
} from "@/lib/config";
import { createRailwayS3SafetyAttestation } from "@/lib/storage/railway-s3-safety";

const safetyNow = new Date("2026-09-03T12:00:00.000Z");
const railwayTarget = {
  endpoint: "https://t3.storageapi.dev",
  region: "auto",
  bucket: "rfp-xray-private",
  forcePathStyle: false
};
const corsOrigins = ["https://rfp.example.com"];

function safetyAttestation(input: {
  target?: typeof railwayTarget;
  issuedAt?: Date;
  expiresAt?: Date;
} = {}) {
  return createRailwayS3SafetyAttestation({
    target: input.target ?? railwayTarget,
    issuedAt: input.issuedAt ?? safetyNow,
    expiresAt: input.expiresAt ?? new Date(safetyNow.getTime() + 24 * 60 * 60_000),
    objectLock: "absent",
    objectVersions: "verified_empty",
    corsExpectedOrigins: corsOrigins,
    corsRules: [{
      allowed_origins: corsOrigins,
      allowed_methods: ["GET", "HEAD", "PUT"],
      allowed_headers: ["content-length", "content-type", "if-none-match"],
      exposed_headers: ["etag"],
      max_age_seconds: 300
    }]
  });
}

describe("production dependency readiness", () => {
  it("fails closed with an explicit list when privacy-critical dependencies are missing", () => {
    const config = getConfig({ NODE_ENV: "production" });
    const readiness = getProductionReadiness(config, {});
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual(expect.arrayContaining([
      "DATABASE_URL", "PRIVATE_STORAGE", "PRIVATE_STORAGE_SAFETY_ATTESTATION", "VERCEL_WORKFLOW",
      "NEON_EXPECTED_MAX_WORKER_PROCESSES",
      "MONID_RESULT_URL_PATH", "MONID_COST_VALUE_UNIT", "MONID_INSPECT_SCHEMA_SHA256",
      "MONID_ARTIFACT_HOST_ALLOWLIST",
      "SESSION_SIGNING_SECRET", "IP_HASH_SECRET", "TURNSTILE_SECRET_KEY",
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_EXPECTED_HOSTNAME", "CRON_SECRET",
      "API_KEY_SHA256", "NEXT_PUBLIC_APP_ORIGIN"
    ]));
  });

  it("accepts a release-validated Railway S3 bucket as private production storage", () => {
    const config = getConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/database",
      NEON_COST_CU_CEILING: "1",
      NEON_EXPECTED_MAX_WORKER_PROCESSES: "13",
      S3_ENDPOINT: railwayTarget.endpoint,
      S3_REGION: "auto",
      S3_BUCKET: "rfp-xray-private",
      S3_ACCESS_KEY_ID: "s3-access-key",
      S3_SECRET_ACCESS_KEY: "s3-secret-key",
      S3_CORS_ALLOWED_ORIGINS: corsOrigins.join(","),
      S3_SAFETY_ATTESTATION: safetyAttestation(),
      S3_REPLAY_FENCE_VALIDATED: "false",
      MONID_API_KEY: "monid-key",
      MONID_PARSE_PROVIDER: "context.dev",
      MONID_PARSE_ENDPOINT: "/parse",
      MONID_RUN_ID_PATH: "id",
      MONID_RUN_STATUS_PATH: "status",
      MONID_PROVIDER_STATUS_PATH: "result.status",
      MONID_RESULT_URL_PATH: "result.artifact.url",
      MONID_COST_VALUE_PATH: "cost.value",
      MONID_COST_CURRENCY_PATH: "cost.currency",
      MONID_COST_VALUE_UNIT: "currency_major",
      MONID_INSPECT_SCHEMA_SHA256: "c".repeat(64),
      MONID_ARTIFACT_HOST_ALLOWLIST: "artifacts.example.com",
      OPENAI_API_KEY: "openai-key",
      SESSION_SIGNING_SECRET: "production-session-secret-that-is-long-enough",
      IP_HASH_SECRET: "production-ip-secret",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      TURNSTILE_EXPECTED_HOSTNAME: "rfp.example.com",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "turnstile-site",
      CRON_SECRET: "production-cron-secret",
      API_KEY_SHA256: "a".repeat(64),
      NEXT_PUBLIC_APP_ORIGIN: "https://rfp.example.com"
    });
    expect(getPrivateStorageProvider(config, { VERCEL: "1" })).toBe("railway_s3");
    expect(getRailwayS3SafetyStatus(config, safetyNow)).toMatchObject({ valid: true });
    // This synchronous check covers configuration only. Admission and health
    // still require the deployment-bound asynchronous provider receipt.
    expect(getProductionReadiness(config, { VERCEL: "1" }, safetyNow)).toEqual({
      ready: true,
      missing: []
    });
    expect(config.OPENAI_EXTRACTION_MODEL).toBe("gpt-5.4-mini");
    expect(config.OPENAI_RUN_RESERVE_MICRO_USD).toBeLessThanOrEqual(500_000);
    expect(Math.ceil(
      config.OPENAI_MAX_INPUT_TOKENS * 0.75 + config.OPENAI_MAX_OUTPUT_TOKENS * 4.5
    )).toBeLessThanOrEqual(config.OPENAI_RUN_RESERVE_MICRO_USD);
    expect(getProductionReadiness({ ...config, MONID_PARSE_PROVIDER: "different" }, { VERCEL: "1" }, safetyNow).missing)
      .toContain("MONID_PARSE_PROVIDER");
    expect(getProductionReadiness({ ...config, MONID_PARSE_ENDPOINT: "/different" }, { VERCEL: "1" }, safetyNow).missing)
      .toContain("MONID_PARSE_ENDPOINT");
    expect(getProductionReadiness({
      ...config,
      NEON_COST_CU_CEILING: 0.99
    }, { VERCEL: "1" }, safetyNow).missing).toContain("NEON_COST_CU_CEILING");
  });

  it.each([
    ["bucket", { ...railwayTarget, bucket: "different-bucket" }],
    ["endpoint", { ...railwayTarget, endpoint: "https://other-storage.example.invalid" }]
  ])("rejects a safety attestation bound to a different %s", (_label, changedTarget) => {
    const config = getConfig({
      NODE_ENV: "production",
      S3_ENDPOINT: railwayTarget.endpoint,
      S3_REGION: railwayTarget.region,
      S3_BUCKET: railwayTarget.bucket,
      S3_ACCESS_KEY_ID: "s3-access-key",
      S3_SECRET_ACCESS_KEY: "s3-secret-key",
      S3_CORS_ALLOWED_ORIGINS: corsOrigins.join(","),
      S3_SAFETY_ATTESTATION: safetyAttestation({ target: changedTarget }),
      NEXT_PUBLIC_APP_ORIGIN: corsOrigins[0]
    });
    expect(getRailwayS3SafetyStatus(config, safetyNow)).toEqual({ valid: false, reason: "target_mismatch" });
    expect(getProductionReadiness(config, { VERCEL: "1" }, safetyNow).missing)
      .toContain("PRIVATE_STORAGE_SAFETY_ATTESTATION");
  });

  it("rejects an expired attestation and ignores the deprecated free boolean", () => {
    const config = getConfig({
      NODE_ENV: "production",
      S3_ENDPOINT: railwayTarget.endpoint,
      S3_REGION: railwayTarget.region,
      S3_BUCKET: railwayTarget.bucket,
      S3_ACCESS_KEY_ID: "s3-access-key",
      S3_SECRET_ACCESS_KEY: "s3-secret-key",
      S3_CORS_ALLOWED_ORIGINS: corsOrigins.join(","),
      S3_SAFETY_ATTESTATION: safetyAttestation({
        issuedAt: new Date(safetyNow.getTime() - 48 * 60 * 60_000),
        expiresAt: new Date(safetyNow.getTime() - 1)
      }),
      S3_REPLAY_FENCE_VALIDATED: "true",
      NEXT_PUBLIC_APP_ORIGIN: corsOrigins[0]
    });
    expect(getRailwayS3SafetyStatus(config, safetyNow)).toEqual({ valid: false, reason: "expired" });
    expect(getProductionReadiness(config, { VERCEL: "1" }, safetyNow).missing)
      .toContain("PRIVATE_STORAGE_SAFETY_ATTESTATION");
  });

  it("rejects an attested arbitrary HTTPS S3 endpoint before credentials can egress", () => {
    const attackerTarget = {
      ...railwayTarget,
      endpoint: "https://credential-sink.example"
    };
    const config = getConfig({
      NODE_ENV: "production",
      S3_ENDPOINT: attackerTarget.endpoint,
      S3_REGION: attackerTarget.region,
      S3_BUCKET: attackerTarget.bucket,
      S3_ACCESS_KEY_ID: "must-not-egress",
      S3_SECRET_ACCESS_KEY: "must-not-egress",
      S3_CORS_ALLOWED_ORIGINS: corsOrigins.join(","),
      S3_SAFETY_ATTESTATION: safetyAttestation({ target: attackerTarget }),
      NEXT_PUBLIC_APP_ORIGIN: corsOrigins[0]
    });
    expect(getRailwayS3SafetyStatus(config, safetyNow)).toEqual({
      valid: false,
      reason: "target_mismatch"
    });
    expect(getProductionReadiness(config, { VERCEL: "1" }, safetyNow).missing)
      .toContain("PRIVATE_STORAGE_SAFETY_ATTESTATION");
  });

  it("does not accept the legacy unbound Blob safety boolean in production", () => {
    const config = getConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/database",
      BLOB_READ_WRITE_TOKEN: "blob-token",
      BLOB_REPLAY_FENCE_VALIDATED: "true",
      MONID_API_KEY: "monid-key",
      MONID_PARSE_PROVIDER: "context.dev",
      MONID_PARSE_ENDPOINT: "/parse",
      MONID_RUN_ID_PATH: "id",
      MONID_RUN_STATUS_PATH: "status",
      MONID_PROVIDER_STATUS_PATH: "result.status",
      MONID_RESULT_URL_PATH: "result.artifact.url",
      MONID_COST_VALUE_PATH: "cost.value",
      MONID_COST_CURRENCY_PATH: "cost.currency",
      MONID_COST_VALUE_UNIT: "currency_major",
      MONID_INSPECT_SCHEMA_SHA256: "d".repeat(64),
      MONID_ARTIFACT_HOST_ALLOWLIST: "artifacts.example.com",
      OPENAI_API_KEY: "openai-key",
      SESSION_SIGNING_SECRET: "production-session-secret-that-is-long-enough",
      IP_HASH_SECRET: "production-ip-secret",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      TURNSTILE_EXPECTED_HOSTNAME: "rfp.example.com",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "turnstile-site",
      CRON_SECRET: "production-cron-secret",
      API_KEY_SHA256: "a".repeat(64),
      NEXT_PUBLIC_APP_ORIGIN: "https://rfp.example.com"
    });
    expect(getPrivateStorageProvider(config, { VERCEL: "1" })).toBeNull();
    expect(getProductionReadiness(config, { VERCEL: "1" }).missing).toEqual(
      expect.arrayContaining(["PRIVATE_STORAGE", "PRIVATE_STORAGE_SAFETY_ATTESTATION"])
    );
  });

  it("does not mistake a project OIDC token for a connected private Blob store", () => {
    const config = getConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/database"
    });
    const readiness = getProductionReadiness(config, {
      VERCEL: "1",
      VERCEL_OIDC_TOKEN: "project-oidc-without-a-blob-store"
    });
    expect(hasPrivateBlobConfig(config, {
      VERCEL_OIDC_TOKEN: "project-oidc-without-a-blob-store"
    })).toBe(false);
    expect(readiness.missing).toContain("PRIVATE_STORAGE");
  });

  it("fails closed on an unbenchmarked OpenAI model", () => {
    expect(() => getConfig({
      NODE_ENV: "test",
      OPENAI_EXTRACTION_MODEL: "unknown-model"
    })).toThrow();
  });

  it("rejects a production Monid credential target outside the exact official origin", () => {
    const config = getConfig({
      NODE_ENV: "production",
      MONID_API_KEY: "must-not-egress",
      MONID_API_BASE_URL: "https://attacker.example"
    });
    expect(getProductionReadiness(config, { VERCEL: "1" }).missing)
      .toContain("MONID_API_BASE_URL");
  });
});
