import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig, resetConfigForTests } from "@/lib/config";
import type { ProviderContractsAttestationHealth } from "@/lib/health/provider-contracts";
import { processRun } from "@/lib/pipeline";
import { createRun } from "@/lib/runs/create";
import type { RunStore } from "@/lib/runs/store";
import { createRailwayS3SafetyAttestation } from "@/lib/storage/railway-s3-safety";

const deployment = {
  id: "dpl_ProviderGate123",
  url: "rfp-xray-provider-gate.vercel.app",
  projectId: "prj_ProviderGate123",
  teamId: "team_ProviderGate123",
  gitSha: "a".repeat(40)
};

function installRuntimeIdentity() {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("VERCEL_DEPLOYMENT_ID", deployment.id);
  vi.stubEnv("VERCEL_URL", deployment.url);
  vi.stubEnv("VERCEL_PROJECT_ID", deployment.projectId);
  vi.stubEnv("RFP_XRAY_VERCEL_TEAM_ID", deployment.teamId);
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", deployment.gitSha);
}

function completeProductionConfig() {
  const issuedAt = new Date();
  const target = {
    endpoint: "https://t3.storageapi.dev",
    region: "auto",
    bucket: "rfp-xray-provider-gate",
    forcePathStyle: false
  };
  const origins = ["https://rfp-xray-provider-gate.example"];
  return getConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://redacted.invalid/database",
    S3_ENDPOINT: target.endpoint,
    S3_REGION: target.region,
    S3_BUCKET: target.bucket,
    S3_ACCESS_KEY_ID: "s3-test-key",
    S3_SECRET_ACCESS_KEY: "s3-test-secret",
    S3_CORS_ALLOWED_ORIGINS: origins.join(","),
    S3_SAFETY_ATTESTATION: createRailwayS3SafetyAttestation({
      target,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 60 * 60_000),
      objectLock: "absent",
      objectVersions: "verified_empty",
      corsExpectedOrigins: origins,
      corsRules: [{
        allowed_origins: origins,
        allowed_methods: ["GET", "HEAD", "PUT"],
        allowed_headers: ["content-length", "content-type", "if-none-match"],
        exposed_headers: ["etag"],
        max_age_seconds: 300
      }]
    }),
    MONID_API_KEY: "monid-test-key",
    MONID_API_BASE_URL: "https://api.monid.ai",
    MONID_PARSE_PROVIDER: "context-dev",
    MONID_PARSE_ENDPOINT: "parse",
    MONID_RUN_ID_PATH: "id",
    MONID_RUN_STATUS_PATH: "status",
    MONID_PROVIDER_STATUS_PATH: "result.status",
    MONID_RESULT_URL_PATH: "result.artifact.url",
    MONID_COST_VALUE_PATH: "cost.value",
    MONID_COST_CURRENCY_PATH: "cost.currency",
    MONID_COST_VALUE_UNIT: "currency_major",
    MONID_INSPECT_SCHEMA_SHA256: "b".repeat(64),
    MONID_ARTIFACT_HOST_ALLOWLIST: "artifacts.monid.ai",
    OPENAI_API_KEY: "openai-test-key",
    SESSION_SIGNING_SECRET: "production-session-secret-that-is-long-enough",
    IP_HASH_SECRET: "production-ip-secret",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    TURNSTILE_EXPECTED_HOSTNAME: "rfp-xray-provider-gate.example",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "turnstile-site-key",
    CRON_SECRET: "production-cron-secret",
    API_KEY_SHA256: "c".repeat(64),
    NEXT_PUBLIC_APP_ORIGIN: origins[0]
  });
}

function workflowProbe() {
  return Promise.resolve({
    status: "attested_300s" as const,
    deploymentId: deployment.id,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    payloadSha256: "d".repeat(64)
  });
}

describe("provider attestation execution gates", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfigForTests();
  });

  it.each([
    { status: "configured_unattested" as const },
    { status: "mismatch" as const }
  ])("blocks createRun before input/store/maintenance work when provider state is $status", async (state) => {
    installRuntimeIdentity();
    const config = completeProductionConfig();
    const storeTouched = vi.fn();
    const forbiddenStore = new Proxy({}, {
      get() {
        storeTouched();
        throw new Error("store must remain untouched");
      }
    }) as RunStore;
    const maintenanceTouched = vi.fn(async () => true);
    await expect(createRun(
      { documents: [] },
      { id: "guest:test", quotaKey: "ip:test", kind: "guest" },
      null,
      {
        config,
        store: forbiddenStore,
        workflowRuntimeAttestationProbe: workflowProbe,
        providerContractsAttestationProbe: async () => state as ProviderContractsAttestationHealth,
        maintenanceHeartbeatReady: maintenanceTouched
      }
    )).rejects.toThrow(/provider contracts/i);
    expect(storeTouched).not.toHaveBeenCalled();
    expect(maintenanceTouched).not.toHaveBeenCalled();
  });

  it.each([
    { status: "configured_unattested" as const },
    { status: "mismatch" as const }
  ])("blocks direct processRun before store/source/provider work when provider state is $status", async (state) => {
    installRuntimeIdentity();
    const config = completeProductionConfig();
    const storeTouched = vi.fn();
    const forbiddenStore = new Proxy({}, {
      get() {
        storeTouched();
        throw new Error("store must remain untouched");
      }
    }) as RunStore;
    const fetcher = vi.fn(async () => { throw new Error("source must remain untouched"); });
    await expect(processRun("00000000-0000-4000-8000-000000000000", {
      config,
      store: forbiddenStore,
      fetcher: fetcher as typeof fetch,
      workflowRuntimeAttestationProbe: workflowProbe,
      providerContractsAttestationProbe: async () => state as ProviderContractsAttestationHealth
    })).rejects.toThrow(/provider contracts/i);
    expect(storeTouched).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
