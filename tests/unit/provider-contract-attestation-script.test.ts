import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import {
  providerContractsConfiguration,
  providerCredentialBindings
} from "@/lib/health/provider-contracts";
import { monidInspectSemanticContractSha256 } from "@/lib/providers/monid-inspect-contract.mjs";
// @ts-expect-error The release utility is deliberately executable plain ESM.
import { ATTESTATION_KIND, MAX_TTL_HOURS, MONID_ORIGIN, OPENAI_BASE_URL, buildProviderContractsAttestation, buildReleaseSubprocessEnvironment, isGloballyReachableAddress, parseReleaseArguments, performProviderChecks, providerConfigurationFromEnvironment, providerCredentialBindingsForDeployment } from "../../scripts/attest-provider-contracts.mjs";

const inspectPayload = {
  provider: "context.dev",
  endpoint: "/parse",
  method: "POST",
  input: {
    bodyType: "json",
    body: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      "~standard": { vendor: "zod", version: 1, jsonSchema: {} },
      type: "object",
      additionalProperties: false,
      required: ["file_url"],
      properties: {
        file_url: { type: "string", format: "uri", description: "Source URL" },
        extension: { type: "string", minLength: 1, maxLength: 16, description: "Extension" },
        ocr: { type: "boolean", description: "OCR" },
        includeLinks: { type: "boolean", description: "Links" },
        includeImages: { type: "boolean", description: "Images" },
        shortenBase64Images: { type: "boolean", description: "Shorten" },
        useMainContentOnly: { type: "boolean", description: "Main content" },
        zdr: { type: "string", enum: ["disabled", "required"], description: "ZDR" }
      }
    }
  },
  price: {
    type: "TIERED",
    amount: { value: 0.0009, currency: "USD" },
    default: { amount: { value: 0.0009, currency: "USD" }, type: "PER_CALL" },
    tiers: [{
      label: "OCR", selector: { in: "body", key: "ocr", label: "OCR" },
      when: { ocr: true },
      price: { amount: { value: 0.0036, currency: "USD" }, type: "PER_CALL" }
    }],
    notes: ["presentation only"]
  },
  metrics: { status: "healthy", runTimeMs: { p50: 100, p95: 200 } },
  description: "must-never-be-stored",
  categories: ["documents"], tags: ["parse"], hints: {}, notes: [],
  docUrl: "https://docs.example/parse", providerName: "Context", summary: "Parse"
};

function environment(overrides: Record<string, string> = {}) {
  return {
    MONID_API_BASE_URL: MONID_ORIGIN,
    MONID_PARSE_PROVIDER: "context.dev",
    MONID_PARSE_ENDPOINT: "/parse",
    MONID_RUN_ID_PATH: "id",
    MONID_RUN_STATUS_PATH: "status",
    MONID_PROVIDER_STATUS_PATH: "result.status",
    MONID_RESULT_URL_PATH: "result.artifact.url",
    MONID_COST_VALUE_PATH: "cost.value",
    MONID_COST_CURRENCY_PATH: "cost.currency",
    MONID_COST_VALUE_UNIT: "currency_major",
    MONID_INSPECT_SCHEMA_SHA256: monidInspectSemanticContractSha256(inspectPayload),
    MONID_ARTIFACT_HOST_ALLOWLIST: "artifacts.monid.ai,download.context.dev",
    OPENAI_EXTRACTION_MODEL: "gpt-5.4-mini",
    OPENAI_QA_MODEL: "gpt-5.4-mini",
    ...overrides
  };
}

const inspection = {
  id: "dpl_ProviderScript123",
  url: "rfp-xray-provider-team.vercel.app",
  target: "production",
  readyState: "READY",
  name: "rfp-xray",
  contextName: "provider-team"
};

const project = {
  projectId: "prj_ProviderScript123",
  projectName: "rfp-xray",
  orgId: "team_ProviderScript123"
};

describe("provider-contract release attestation script", () => {
  it("rejects special-use addresses while accepting ordinary global addresses", () => {
    for (const address of [
      "127.0.0.1",
      "192.0.0.8",
      "192.0.0.170",
      "100::1",
      "2001:2::1",
      "2001:10::1",
      "64:ff9b:1::1"
    ]) expect(isGloballyReachableAddress(address), address).toBe(false);
    expect(isGloballyReachableAddress("93.184.216.34")).toBe(true);
    expect(isGloballyReachableAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("builds the exact same sanitized configuration as the runtime validator", () => {
    const values = environment();
    const runtimeConfig = getConfig({
      NODE_ENV: "production",
      MONID_API_KEY: "monid-test-secret",
      OPENAI_API_KEY: "openai-test-secret",
      ...values
    });
    expect(providerConfigurationFromEnvironment(values))
      .toEqual(providerContractsConfiguration(runtimeConfig));
    const identity = {
      deployment_id: inspection.id,
      deployment_url: inspection.url,
      project_id: project.projectId,
      team_id: project.orgId,
      git_commit_sha: "a".repeat(40)
    };
    expect(providerCredentialBindingsForDeployment({
      deploymentId: identity.deployment_id,
      deploymentUrl: identity.deployment_url,
      projectId: identity.project_id,
      teamId: identity.team_id,
      gitCommitSha: identity.git_commit_sha,
      monidApiKey: runtimeConfig.MONID_API_KEY,
      openaiApiKey: runtimeConfig.OPENAI_API_KEY
    })).toEqual(providerCredentialBindings(runtimeConfig, identity));
  });

  it("requires an explicit exact store confirmation and caps TTL at 24 hours", () => {
    expect(() => parseReleaseArguments([
      "--deployment", "https://example.vercel.app",
      "--scope", "provider-team"
    ])).toThrow(/STORE_NOT_CONFIRMED/);
    expect(() => parseReleaseArguments([
      "--deployment", "https://example.vercel.app",
      "--scope", "provider-team",
      "--ttl-hours", String(MAX_TTL_HOURS + 1),
      "--confirm-store", ATTESTATION_KIND
    ])).toThrow(/INVALID_TTL/);
    expect(parseReleaseArguments([
      "--deployment", "https://example.vercel.app",
      "--scope", "provider-team",
      "--confirm-store", ATTESTATION_KIND
    ]).ttlHours).toBe(24);
  });

  it("never forwards provider, database, or application secrets to child processes", () => {
    const child = buildReleaseSubprocessEnvironment({
      PATH: "safe-path",
      VERCEL_TOKEN: "vercel-token",
      DATABASE_URL: "database-secret",
      MONID_API_KEY: "monid-secret",
      OPENAI_API_KEY: "openai-secret",
      SESSION_SIGNING_SECRET: "session-secret"
    }, true);
    expect(child).toMatchObject({ PATH: "safe-path", VERCEL_TOKEN: "vercel-token", CI: "1" });
    expect(child).not.toHaveProperty("DATABASE_URL");
    expect(child).not.toHaveProperty("MONID_API_KEY");
    expect(child).not.toHaveProperty("OPENAI_API_KEY");
    expect(child).not.toHaveProperty("SESSION_SIGNING_SECRET");
  });

  it("checks only the exact non-paid endpoints with redirects disabled and returns hashes, not responses", async () => {
    const configuration = providerConfigurationFromEnvironment({
      ...environment(),
      // An ambient SDK override is deliberately ignored.
      OPENAI_BASE_URL: "https://credential-sink.example/v1"
    });
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input.toString();
      requests.push({ url, init: init ?? {} });
      if (url === `${MONID_ORIGIN}/v1/inspect`) {
        const telemetryDrift = structuredClone(inspectPayload);
        telemetryDrift.metrics = {
          status: "changed",
          runTimeMs: { p50: 9_999, p95: 20_000 }
        };
        telemetryDrift.description = "changed presentation";
        telemetryDrift.input.body.properties.file_url.description = "changed field description";
        telemetryDrift.price.notes = ["changed price note"];
        return new Response(JSON.stringify(telemetryDrift), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url === `${OPENAI_BASE_URL}/models/gpt-5.4-mini`) {
        return new Response(JSON.stringify({
          id: "gpt-5.4-mini",
          object: "model",
          owned_by: "must-never-be-stored"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error("unexpected target");
    }) as typeof fetch;
    const checks = await performProviderChecks({
      configuration,
      monidApiKey: "monid-test-secret",
      openaiApiKey: "openai-test-secret",
      fetcher,
      resolveHostname: async () => ["93.184.216.34"]
    });
    expect(requests.map((request) => request.url)).toEqual([
      `${MONID_ORIGIN}/v1/inspect`,
      `${OPENAI_BASE_URL}/models/gpt-5.4-mini`
    ]);
    expect(requests.every((request) => request.init.redirect === "manual")).toBe(true);
    expect(checks).toEqual({
      monidInspectSha256: environment().MONID_INSPECT_SCHEMA_SHA256,
      checkedModels: ["gpt-5.4-mini"]
    });
    expect(JSON.stringify(checks)).not.toContain("must-never-be-stored");
    expect(JSON.stringify(checks)).not.toContain("test-secret");
  });

  it("rejects inspect hash drift, redirects, unsafe DNS, and wrong official origins", async () => {
    const changed = providerConfigurationFromEnvironment({
      ...environment(),
      MONID_INSPECT_SCHEMA_SHA256: "f".repeat(64)
    });
    await expect(performProviderChecks({
      configuration: changed,
      monidApiKey: "monid-test-secret",
      openaiApiKey: "openai-test-secret",
      fetcher: (async () => new Response(JSON.stringify(inspectPayload), { status: 200 })) as typeof fetch,
      resolveHostname: async () => ["93.184.216.34"]
    })).rejects.toThrow(/MONID_INSPECT_HASH_MISMATCH/);

    const semanticDriftRequests: string[] = [];
    await expect(performProviderChecks({
      configuration: providerConfigurationFromEnvironment(environment()),
      monidApiKey: "monid-test-secret",
      openaiApiKey: "openai-test-secret",
      fetcher: (async (input: URL | RequestInfo) => {
        const url = input.toString();
        semanticDriftRequests.push(url);
        if (url !== `${MONID_ORIGIN}/v1/inspect`) throw new Error("paid dispatch boundary crossed");
        const drifted = structuredClone(inspectPayload);
        drifted.input.bodyType = "different-body-type";
        return new Response(JSON.stringify(drifted), { status: 200 });
      }) as typeof fetch,
      resolveHostname: async () => ["93.184.216.34"]
    })).rejects.toThrow(/MONID_INSPECT_HASH_MISMATCH/);
    expect(semanticDriftRequests).toEqual([`${MONID_ORIGIN}/v1/inspect`]);

    const configuration = providerConfigurationFromEnvironment(environment());
    await expect(performProviderChecks({
      configuration,
      monidApiKey: "monid-test-secret",
      openaiApiKey: "openai-test-secret",
      fetcher: (async () => new Response(null, {
        status: 302,
        headers: { location: "https://credential-sink.example" }
      })) as typeof fetch,
      resolveHostname: async () => ["93.184.216.34"]
    })).rejects.toThrow(/PROVIDER_REDIRECT_REJECTED/);
    await expect(performProviderChecks({
      configuration,
      monidApiKey: "monid-test-secret",
      openaiApiKey: "openai-test-secret",
      fetcher: (async () => { throw new Error("must not fetch"); }) as typeof fetch,
      resolveHostname: async () => ["127.0.0.1"]
    })).rejects.toThrow(/PROVIDER_DNS_UNSAFE/);
    expect(() => providerConfigurationFromEnvironment(environment({
      MONID_API_BASE_URL: "https://api.monid.ai.evil.example"
    }))).toThrow(/PROVIDER_ORIGIN_INVALID/);
  });

  it("stores only a sanitized deployment/config/check payload and rejects overlong evidence", () => {
    const configuration = providerConfigurationFromEnvironment(environment());
    const credentialBindings = providerCredentialBindingsForDeployment({
      deploymentId: inspection.id,
      deploymentUrl: inspection.url,
      projectId: project.projectId,
      teamId: project.orgId,
      gitCommitSha: "a".repeat(40),
      monidApiKey: "monid-test-secret",
      openaiApiKey: "openai-test-secret"
    });
    const checks = {
      monidInspectSha256: environment().MONID_INSPECT_SCHEMA_SHA256,
      checkedModels: ["gpt-5.4-mini"],
      credentialBindings
    };
    const issuedAt = new Date("2026-09-03T18:00:00.000Z");
    const expiresAt = new Date(issuedAt.getTime() + 24 * 60 * 60_000);
    const result = buildProviderContractsAttestation({
      inspection,
      project,
      scope: "provider-team",
      gitCommitSha: "a".repeat(40),
      configuration,
      checks,
      issuedAt,
      expiresAt
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("must-never-be-stored");
    expect(serialized).not.toContain("test-secret");
    expect(result.payload.checks.monid_inspect.canonical_response_sha256)
      .toBe(configuration.monid.inspect_schema_sha256);
    expect(result.payload.credential_bindings).toEqual(credentialBindings);
    expect(providerCredentialBindingsForDeployment({
      deploymentId: inspection.id,
      deploymentUrl: inspection.url,
      projectId: project.projectId,
      teamId: project.orgId,
      gitCommitSha: "a".repeat(40),
      monidApiKey: "different-monid-key",
      openaiApiKey: "openai-test-secret"
    }).monid_hmac_sha256).not.toBe(credentialBindings.monid_hmac_sha256);
    expect(() => buildProviderContractsAttestation({
      inspection,
      project,
      scope: "provider-team",
      gitCommitSha: "a".repeat(40),
      configuration,
      checks,
      issuedAt,
      expiresAt: new Date(expiresAt.getTime() + 1)
    })).toThrow(/INVALID_ATTESTATION_LIFETIME/);
  });
});
