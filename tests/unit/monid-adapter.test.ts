import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import { MonidAdapter } from "@/lib/providers/monid";

function monidConfig(resultPath = "result.artifact.url") {
  return getConfig({
    NODE_ENV: "test",
    MONID_API_KEY: "test-key",
    MONID_API_BASE_URL: "https://api.monid.test",
    MONID_PARSE_PROVIDER: "context-dev",
    MONID_PARSE_ENDPOINT: "parse",
    MONID_RESULT_URL_PATH: resultPath,
    SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough"
  });
}

describe("Monid nested run adapter", () => {
  it("sends the locked nested /v1/run input, polls, validates nested 2xx, and downloads immediately", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let poll = 0;
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input.toString();
      requests.push({ url, init });
      if (url.endsWith("/v1/run")) return Response.json({ id: "run-123" });
      if (url.endsWith("/v1/runs/run-123")) {
        poll += 1;
        return Response.json(poll === 1
          ? { status: "RUNNING" }
          : {
              status: "COMPLETED",
              result: { status: 200, artifact: { url: "https://artifacts.monid.test/result.md" } },
              cost: { value: 0.0045, currency: "USD" }
            });
      }
      if (url === "https://artifacts.monid.test/result.md") {
        return new Response("# Parsed tender\nGrounded body", { headers: { "content-type": "text/markdown" } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    const adapter = new MonidAdapter({
      config: monidConfig(),
      fetcher,
      sleep: async () => undefined,
      pollIntervalMs: 0,
      maxPolls: 3
    });
    const result = await adapter.parse({ fileUrl: "https://private-blob.test/source.pdf", ocr: true });
    expect(result.markdown).toContain("Parsed tender");
    expect(result).toMatchObject({ runId: "run-123", costMicroUsd: 0.0045, costCurrency: "USD", providerRetention: "unknown" });
    const body = JSON.parse(String(requests.find((request) => request.url.endsWith("/v1/run"))?.init?.body));
    expect(body).toEqual({
      provider: "context-dev",
      endpoint: "parse",
      input: {
        body: {
          file_url: "https://private-blob.test/source.pdf",
          extension: "pdf",
          ocr: true,
          includeLinks: false,
          includeImages: false,
          shortenBase64Images: true,
          useMainContentOnly: false
        }
      }
    });
    expect(requests.at(-1)?.url).toBe("https://artifacts.monid.test/result.md");
  });

  it("fails a COMPLETED lifecycle whose nested provider HTTP status is not 2xx", async () => {
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = input.toString();
      if (url.endsWith("/v1/run")) return Response.json({ id: "run-500" });
      return Response.json({
        status: "COMPLETED",
        result: { status: 500, artifact: { url: "https://artifacts.monid.test/result.md" } }
      });
    }) as typeof fetch;
    const adapter = new MonidAdapter({ config: monidConfig(), fetcher, sleep: async () => undefined });
    await expect(adapter.parse({ fileUrl: "https://private-blob.test/source.pdf" }))
      .rejects.toMatchObject({ code: "MONID_PARSE_FAILED" });
  });

  it("requires an inspected configurable result path instead of guessing provider output", async () => {
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = input.toString();
      if (url.endsWith("/v1/run")) return Response.json({ id: "run-no-path" });
      return Response.json({ status: "COMPLETED", result: { status: 200, download: "https://example.test/a.md" } });
    }) as typeof fetch;
    const adapter = new MonidAdapter({ config: monidConfig("result.artifact.url"), fetcher, sleep: async () => undefined });
    await expect(adapter.parse({ fileUrl: "https://private-blob.test/source.pdf" }))
      .rejects.toThrow(/configured path/);
  });
});
