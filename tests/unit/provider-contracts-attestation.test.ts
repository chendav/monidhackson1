import { describe, expect, it } from "vitest";
import type { ReleaseAttestationRow } from "@/db/release-attestation-store";
import { getConfig } from "@/lib/config";
import { sha256Hex, stableJson } from "@/lib/crypto";
import {
  MONID_CONTROL_PLANE_ORIGIN,
  MONID_INSPECT_PATH,
  MONID_RUN_PATH,
  MONID_RUN_STATUS_PATH_TEMPLATE,
  OPENAI_CONTROL_PLANE_BASE_URL,
  PROVIDER_CONTRACTS_ATTESTATION_KIND,
  PROVIDER_CONTRACTS_MIN_REMAINING_MS,
  assertProviderContractsActivelyVerified,
  canonicalArtifactHostAllowlist,
  probeProviderContractsAttestation,
  providerCredentialBindings,
  providerContractsConfiguration,
  type ProviderContractsAttestationPayload
} from "@/lib/health/provider-contracts";

const now = new Date("2026-09-03T18:00:00.000Z");
const runtimeEnvironment = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_DEPLOYMENT_ID: "dpl_ProviderProof123",
  VERCEL_URL: "rfp-xray-provider-team.vercel.app",
  VERCEL_PROJECT_ID: "prj_ProviderProject123",
  RFP_XRAY_VERCEL_TEAM_ID: "team_ProviderTeam123",
  VERCEL_GIT_COMMIT_SHA: "b".repeat(40)
};

function productionConfig(overrides: Record<string, string> = {}) {
  return getConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://redacted.invalid/database",
    MONID_API_KEY: "monid-secret-not-in-receipt",
    MONID_API_BASE_URL: MONID_CONTROL_PLANE_ORIGIN,
    MONID_PARSE_PROVIDER: "context-dev",
    MONID_PARSE_ENDPOINT: "parse",
    MONID_RUN_ID_PATH: "id",
    MONID_RUN_STATUS_PATH: "status",
    MONID_PROVIDER_STATUS_PATH: "result.status",
    MONID_RESULT_URL_PATH: "result.artifact.url",
    MONID_COST_VALUE_PATH: "cost.value",
    MONID_COST_CURRENCY_PATH: "cost.currency",
    MONID_COST_VALUE_UNIT: "currency_major",
    MONID_INSPECT_SCHEMA_SHA256: "c".repeat(64),
    MONID_ARTIFACT_HOST_ALLOWLIST: "download.context.dev,artifacts.monid.ai",
    OPENAI_API_KEY: "openai-secret-not-in-receipt",
    OPENAI_EXTRACTION_MODEL: "gpt-5.4-mini",
    OPENAI_QA_MODEL: "gpt-5.4-mini",
    ...overrides
  });
}

function payload(
  config = productionConfig(),
  overrides: { issuedAt?: Date; expiresAt?: Date } = {}
): ProviderContractsAttestationPayload {
  const contracts = providerContractsConfiguration(config);
  if (!contracts) throw new Error("test provider configuration is invalid");
  const credentialBindings = providerCredentialBindings(config, {
    deployment_id: runtimeEnvironment.VERCEL_DEPLOYMENT_ID,
    deployment_url: runtimeEnvironment.VERCEL_URL,
    project_id: runtimeEnvironment.VERCEL_PROJECT_ID,
    team_id: runtimeEnvironment.RFP_XRAY_VERCEL_TEAM_ID,
    git_commit_sha: runtimeEnvironment.VERCEL_GIT_COMMIT_SHA
  });
  if (!credentialBindings) throw new Error("test provider credentials are invalid");
  return {
    version: 1,
    issued_at: (overrides.issuedAt ?? new Date(now.getTime() - 60_000)).toISOString(),
    expires_at: (overrides.expiresAt ?? new Date(now.getTime() + 60 * 60_000)).toISOString(),
    deployment: {
      id: runtimeEnvironment.VERCEL_DEPLOYMENT_ID,
      url: runtimeEnvironment.VERCEL_URL,
      target: "production",
      ready_state: "READY",
      project: { id: runtimeEnvironment.VERCEL_PROJECT_ID, name: "rfp-xray" },
      team: { id: runtimeEnvironment.RFP_XRAY_VERCEL_TEAM_ID, slug: "provider-team" },
      git_commit_sha: runtimeEnvironment.VERCEL_GIT_COMMIT_SHA
    },
    contracts,
    credential_bindings: credentialBindings,
    checks: {
      monid_inspect: {
        status: "verified_non_paid",
        canonical_response_sha256: contracts.monid.inspect_schema_sha256
      },
      openai_models: contracts.openai.checked_models.map((model) => ({
        model,
        status: "available_non_paid"
      }))
    }
  };
}

function row(value: unknown): ReleaseAttestationRow {
  const candidate = value as ProviderContractsAttestationPayload;
  return {
    kind: PROVIDER_CONTRACTS_ATTESTATION_KIND,
    deployment_id: candidate.deployment.id,
    deployment_url: candidate.deployment.url,
    project_id: candidate.deployment.project.id,
    team_id: candidate.deployment.team.id,
    git_commit_sha: candidate.deployment.git_commit_sha,
    payload: value,
    payload_sha256: sha256Hex(stableJson(value)),
    issued_at: candidate.issued_at,
    expires_at: candidate.expires_at
  };
}

async function inspect(
  rows: ReleaseAttestationRow[],
  config = productionConfig(),
  environment: Partial<NodeJS.ProcessEnv> = runtimeEnvironment
) {
  return probeProviderContractsAttestation(
    config.DATABASE_URL,
    config,
    environment,
    now,
    { query: async () => rows }
  );
}

describe("deployment-bound provider contract attestation", () => {
  it("accepts only the exact current deployment and complete sanitized contract", async () => {
    const value = payload();
    const result = await inspect([row(value)]);
    expect(result).toMatchObject({
      status: "actively_verified",
      deploymentId: runtimeEnvironment.VERCEL_DEPLOYMENT_ID
    });
    expect(stableJson(value)).not.toContain("monid-secret-not-in-receipt");
    expect(stableJson(value)).not.toContain("openai-secret-not-in-receipt");
    expect(value.contracts.monid).toMatchObject({
      api_origin: MONID_CONTROL_PLANE_ORIGIN,
      inspect_path: MONID_INSPECT_PATH,
      run_path: MONID_RUN_PATH,
      run_status_path_template: MONID_RUN_STATUS_PATH_TEMPLATE,
      run_id_path: "id",
      run_status_path: "status",
      provider_status_path: "result.status",
      result_url_path: "result.artifact.url",
      cost_value_path: "cost.value",
      cost_currency_path: "cost.currency",
      cost_value_unit: "currency_major"
    });
    expect(value.contracts.openai.api_base_url).toBe(OPENAI_CONTROL_PLANE_BASE_URL);
  });

  it("distinguishes absent, expired, and invalid receipts", async () => {
    await expect(inspect([])).resolves.toEqual({ status: "configured_unattested" });
    await expect(probeProviderContractsAttestation(
      undefined,
      productionConfig(),
      runtimeEnvironment,
      now
    )).resolves.toEqual({ status: "configured_unattested" });
    const expired = payload(productionConfig(), {
      issuedAt: new Date(now.getTime() - 2 * 60 * 60_000),
      expiresAt: new Date(now.getTime() - 1)
    });
    await expect(inspect([row(expired)])).resolves.toEqual({ status: "expired" });
    const tooCloseToExpiry = payload(productionConfig(), {
      expiresAt: new Date(now.getTime() + PROVIDER_CONTRACTS_MIN_REMAINING_MS)
    });
    await expect(inspect([row(tooCloseToExpiry)]))
      .resolves.toEqual({ status: "expired" });
    const overlong = payload(productionConfig(), {
      issuedAt: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000)
    });
    await expect(inspect([row(overlong)])).resolves.toEqual({ status: "mismatch" });
  });

  it("rejects tampered payloads, duplicated columns, and full-response hash drift", async () => {
    const value = payload();
    const valid = row(value);
    await expect(inspect([{ ...valid, payload_sha256: "d".repeat(64) }]))
      .resolves.toEqual({ status: "mismatch" });
    await expect(inspect([{ ...valid, project_id: "prj_DifferentProject123" }]))
      .resolves.toEqual({ status: "mismatch" });
    const changedInspect = structuredClone(value) as unknown as Record<string, unknown>;
    const contracts = changedInspect.contracts as Record<string, Record<string, unknown>>;
    contracts.monid.inspect_schema_sha256 = "e".repeat(64);
    await expect(inspect([row(changedInspect)])).resolves.toEqual({ status: "mismatch" });
  });

  it("rejects configuration and deployment drift even when the row hash is valid", async () => {
    const valid = row(payload());
    await expect(inspect([valid], productionConfig({ MONID_PARSE_ENDPOINT: "different" })))
      .resolves.toEqual({ status: "mismatch" });
    await expect(inspect([valid], productionConfig({
      MONID_ARTIFACT_HOST_ALLOWLIST: "different.example"
    }))).resolves.toEqual({ status: "mismatch" });
    await expect(inspect([valid], productionConfig(), {
      ...runtimeEnvironment,
      VERCEL_DEPLOYMENT_ID: "dpl_DifferentProviderProof123"
    })).resolves.toEqual({ status: "mismatch" });
  });

  it("rejects a receipt checked with provider keys other than those installed in the deployment", async () => {
    const valid = row(payload());
    await expect(inspect([valid], productionConfig({ MONID_API_KEY: "different-monid-key" })))
      .resolves.toEqual({ status: "mismatch" });
    await expect(inspect([valid], productionConfig({ OPENAI_API_KEY: "different-openai-key" })))
      .resolves.toEqual({ status: "mismatch" });
  });

  it("rejects non-official origins in configuration or receipt", async () => {
    expect(providerContractsConfiguration(productionConfig({
      MONID_API_BASE_URL: "https://api.monid.ai.evil.example"
    }))).toBeNull();
    const value = structuredClone(payload()) as unknown as Record<string, unknown>;
    const contracts = value.contracts as Record<string, Record<string, unknown>>;
    contracts.openai.api_base_url = "https://api.openai.com.evil.example/v1";
    await expect(inspect([row(value)])).resolves.toEqual({ status: "mismatch" });
  });

  it("canonicalizes an exact artifact allowlist and rejects wildcards or duplicates", () => {
    expect(canonicalArtifactHostAllowlist("B.example,a.example")).toEqual([
      "a.example",
      "b.example"
    ]);
    expect(canonicalArtifactHostAllowlist("*.example")).toBeNull();
    expect(canonicalArtifactHostAllowlist("a.example,a.example")).toBeNull();
  });

  it("enforces production only and reuses only a branded same-config capability", async () => {
    await expect(assertProviderContractsActivelyVerified(getConfig({ NODE_ENV: "test" }), {
      probe: async () => ({ status: "mismatch" })
    })).resolves.toBeNull();
    const config = productionConfig();
    const active = await inspect([row(payload(config))], config);
    if (active.status !== "actively_verified") throw new Error("expected active receipt");
    const capability = await assertProviderContractsActivelyVerified(config, {
      environment: runtimeEnvironment,
      now,
      probe: async () => active
    });
    expect(capability).not.toBeNull();
    await expect(assertProviderContractsActivelyVerified(config, {
      environment: runtimeEnvironment,
      now,
      capability: capability!,
      probe: async () => { throw new Error("must not query twice"); }
    })).resolves.toBe(capability);
    await expect(assertProviderContractsActivelyVerified(
      productionConfig({ MONID_PARSE_PROVIDER: "changed-provider" }),
      { environment: runtimeEnvironment, now, capability: capability! }
    )).rejects.toMatchObject({ code: "ANALYSIS_INCOMPLETE", httpStatus: 503 });
    await expect(assertProviderContractsActivelyVerified(
      productionConfig({ OPENAI_API_KEY: "changed-openai-key" }),
      { environment: runtimeEnvironment, now, capability: capability! }
    )).rejects.toMatchObject({ code: "ANALYSIS_INCOMPLETE", httpStatus: 503 });
  });
});
