import { describe, expect, it } from "vitest";
import { getConfig, getProductionReadiness } from "@/lib/config";

describe("production dependency readiness", () => {
  it("fails closed with an explicit list when privacy-critical dependencies are missing", () => {
    const config = getConfig({ NODE_ENV: "production" });
    const readiness = getProductionReadiness(config, {});
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual(expect.arrayContaining([
      "DATABASE_URL", "PRIVATE_BLOB", "BLOB_REPLAY_FENCE_VALIDATED", "VERCEL_WORKFLOW",
      "MONID_RESULT_URL_PATH", "MONID_ARTIFACT_HOST_ALLOWLIST",
      "SESSION_SIGNING_SECRET", "IP_HASH_SECRET", "TURNSTILE_SECRET_KEY",
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_EXPECTED_HOSTNAME", "CRON_SECRET"
    ]));
  });

  it("reports ready only for a complete explicitly normalized live configuration", () => {
    const config = getConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://example.invalid/database",
      BLOB_READ_WRITE_TOKEN: "blob-token",
      BLOB_REPLAY_FENCE_VALIDATED: "true",
      MONID_API_KEY: "monid-key",
      MONID_PARSE_PROVIDER: "context-dev",
      MONID_PARSE_ENDPOINT: "parse",
      MONID_RUN_ID_PATH: "id",
      MONID_RUN_STATUS_PATH: "status",
      MONID_PROVIDER_STATUS_PATH: "result.status",
      MONID_RESULT_URL_PATH: "result.artifact.url",
      MONID_COST_VALUE_PATH: "cost.value",
      MONID_COST_CURRENCY_PATH: "cost.currency",
      MONID_ARTIFACT_HOST_ALLOWLIST: "artifacts.example.com",
      OPENAI_API_KEY: "openai-key",
      SESSION_SIGNING_SECRET: "production-session-secret-that-is-long-enough",
      IP_HASH_SECRET: "production-ip-secret",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      TURNSTILE_EXPECTED_HOSTNAME: "rfp.example.com",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "turnstile-site",
      CRON_SECRET: "production-cron-secret"
    });
    expect(getProductionReadiness(config, { VERCEL: "1" })).toEqual({ ready: true, missing: [] });
    expect(config.OPENAI_EXTRACTION_MODEL).toBe("gpt-5.4-mini");
    expect(config.OPENAI_RUN_RESERVE_MICRO_USD).toBeLessThanOrEqual(500_000);
    expect(Math.ceil(
      config.OPENAI_MAX_INPUT_TOKENS * 0.75 + config.OPENAI_MAX_OUTPUT_TOKENS * 4.5
    )).toBeLessThanOrEqual(config.OPENAI_RUN_RESERVE_MICRO_USD);
  });

  it("fails closed on an unbenchmarked OpenAI model", () => {
    expect(() => getConfig({
      NODE_ENV: "test",
      OPENAI_EXTRACTION_MODEL: "unknown-model"
    })).toThrow();
  });
});
