import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import {
  MonidAdapter,
  monidInspectResponseSha256
} from "@/lib/providers/monid";

const inspectedContract = {
  provider: "context-dev",
  endpoint: "parse",
  input_schema: { type: "object", required: ["file_url"] },
  run_schema: { cost: { value: "number", currency: "string" } }
};
const inspectedContractSha256 = monidInspectResponseSha256(inspectedContract);

function withCredentialedInspect(fetcher: typeof fetch): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) =>
    input.toString().endsWith("/v1/inspect")
      ? Response.json(inspectedContract)
      : fetcher(input, init)) as typeof fetch;
}

function monidConfig(resultPath = "result.artifact.url") {
  return getConfig({
    NODE_ENV: "test",
    MONID_API_KEY: "test-key",
    MONID_API_BASE_URL: "https://api.monid.test",
    MONID_PARSE_PROVIDER: "context-dev",
    MONID_PARSE_ENDPOINT: "parse",
    MONID_RESULT_URL_PATH: resultPath,
    MONID_COST_VALUE_PATH: "cost.value",
    MONID_COST_CURRENCY_PATH: "cost.currency",
    MONID_COST_VALUE_UNIT: "currency_major",
    MONID_INSPECT_SCHEMA_SHA256: inspectedContractSha256,
    MONID_ARTIFACT_HOST_ALLOWLIST: "artifacts.monid.test",
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
      fetcher: withCredentialedInspect(fetcher),
      sleep: async () => undefined,
      pollIntervalMs: 0,
      maxPolls: 3,
      resolveHostname: async () => ["93.184.216.34"]
    });
    const result = await adapter.parse({ fileUrl: "https://private-blob.test/source.pdf", ocr: true });
    expect(result.markdown).toContain("Parsed tender");
    expect(result).toMatchObject({
      runId: "run-123",
      costAmount: 0.0045,
      costValueUnit: "currency_major",
      costCurrency: "USD",
      costProvenance: {
        kind: "credentialed_inspect",
        inspect_schema_sha256: inspectedContractSha256,
        value_path: "cost.value",
        currency_path: "cost.currency",
        value_unit: "currency_major",
        source_value: 0.0045,
        source_currency: "USD"
      },
      providerRetention: "unknown"
    });
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
    const adapter = new MonidAdapter({
      config: monidConfig(), fetcher: withCredentialedInspect(fetcher), sleep: async () => undefined,
      resolveHostname: async () => ["93.184.216.34"]
    });
    await expect(adapter.parse({ fileUrl: "https://private-blob.test/source.pdf" }))
      .rejects.toMatchObject({
        code: "MONID_PARSE_FAILED",
        terminalProviderFailure: true,
        providerRunId: "run-500",
        lifecycleStatus: "NESTED_HTTP_FAILURE"
      });
  });

  it("requires an inspected configurable result path instead of guessing provider output", async () => {
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = input.toString();
      if (url.endsWith("/v1/run")) return Response.json({ id: "run-no-path" });
      return Response.json({ status: "COMPLETED", result: { status: 200, download: "https://example.test/a.md" } });
    }) as typeof fetch;
    const adapter = new MonidAdapter({
      config: monidConfig("result.artifact.url"), fetcher: withCredentialedInspect(fetcher), sleep: async () => undefined,
      resolveHostname: async () => ["93.184.216.34"]
    });
    await expect(adapter.parse({ fileUrl: "https://private-blob.test/source.pdf" }))
      .rejects.toThrow(/configured path/);
  });

  it("rejects allowlisted hostnames that resolve to private networks before artifact fetch", async () => {
    let artifactFetched = false;
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = input.toString();
      if (url.endsWith("/v1/run")) return Response.json({ id: "run-private" });
      if (url.endsWith("/v1/runs/run-private")) return Response.json({
        status: "COMPLETED",
        result: { status: 200, artifact: { url: "https://artifacts.monid.test/result.md" } }
      });
      artifactFetched = true;
      return new Response("should not be fetched");
    }) as typeof fetch;
    const adapter = new MonidAdapter({
      config: monidConfig(), fetcher: withCredentialedInspect(fetcher), sleep: async () => undefined,
      resolveHostname: async (hostname) => hostname === "api.monid.test"
        ? ["93.184.216.34"]
        : ["127.0.0.1"]
    });
    await expect(adapter.parse({ fileUrl: "https://private-blob.test/source.pdf" }))
      .rejects.toMatchObject({ code: "MONID_PARSE_FAILED" });
    expect(artifactFetched).toBe(false);
  });

  it("revalidates every manual artifact redirect against the exact host allowlist", async () => {
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = input.toString();
      if (url.endsWith("/v1/run")) return Response.json({ id: "run-redirect" });
      if (url.endsWith("/v1/runs/run-redirect")) return Response.json({
        status: "COMPLETED",
        result: { status: 200, artifact: { url: "https://artifacts.monid.test/result.md" } }
      });
      return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secret" } });
    }) as typeof fetch;
    const adapter = new MonidAdapter({
      config: monidConfig(), fetcher: withCredentialedInspect(fetcher), sleep: async () => undefined,
      resolveHostname: async () => ["93.184.216.34"]
    });
    await expect(adapter.parse({ fileUrl: "https://private-blob.test/source.pdf" }))
      .rejects.toMatchObject({ code: "MONID_PARSE_FAILED" });
  });

  it("rejects a non-canonical production API base before resolving or sending the Bearer credential", async () => {
    const fetcher = (async () => {
      throw new Error("the credential must not leave the process");
    }) as typeof fetch;
    let resolveCalls = 0;
    const config = getConfig({
      NODE_ENV: "production",
      MONID_API_KEY: "test-key",
      MONID_API_BASE_URL: "https://api.monid.ai.evil.test",
      MONID_PARSE_PROVIDER: "context-dev",
      MONID_PARSE_ENDPOINT: "parse",
      MONID_RESULT_URL_PATH: "result.artifact.url",
      MONID_ARTIFACT_HOST_ALLOWLIST: "artifacts.monid.test",
      SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough"
    });
    const adapter = new MonidAdapter({
      config,
      fetcher,
      resolveHostname: async () => {
        resolveCalls += 1;
        return ["93.184.216.34"];
      }
    });

    await expect(adapter.inspect()).rejects.toMatchObject({ code: "MONID_PARSE_FAILED" });
    expect(resolveCalls).toBe(0);
  });

  it("allows only the canonical public Monid production origin", async () => {
    const requests: string[] = [];
    const adapter = new MonidAdapter({
      config: getConfig({
        NODE_ENV: "production",
        MONID_API_KEY: "test-key",
        MONID_API_BASE_URL: "https://api.monid.ai",
        MONID_PARSE_PROVIDER: "context-dev",
        MONID_PARSE_ENDPOINT: "parse",
        SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough"
      }),
      fetcher: (async (input: URL | RequestInfo) => {
        requests.push(input.toString());
        return Response.json({ provider: "context-dev", endpoint: "parse" });
      }) as typeof fetch,
      resolveHostname: async (hostname) => {
        expect(hostname).toBe("api.monid.ai");
        return ["104.18.1.1"];
      }
    });
    await expect(adapter.inspect()).resolves.toMatchObject({ provider: "context-dev" });
    expect(requests).toEqual(["https://api.monid.ai/v1/inspect"]);
  });

  it.each([
    "http://api.monid.ai",
    "https://user@api.monid.ai",
    "https://api.monid.ai:8443",
    "https://api.monid.ai/v1",
    "https://api.monid.ai/?region=test",
    "https://api.monid.ai/#fragment"
  ])("rejects unsafe production API base %s before fetch", async (baseUrl) => {
    const fetcher = (async () => {
      throw new Error("must not fetch");
    }) as typeof fetch;
    const adapter = new MonidAdapter({
      config: getConfig({
        NODE_ENV: "production",
        MONID_API_KEY: "test-key",
        MONID_API_BASE_URL: baseUrl,
        MONID_PARSE_PROVIDER: "context-dev",
        MONID_PARSE_ENDPOINT: "parse",
        SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough"
      }),
      fetcher,
      resolveHostname: async () => ["93.184.216.34"]
    });
    await expect(adapter.inspect()).rejects.toMatchObject({ code: "MONID_PARSE_FAILED" });
  });

  it("rejects a private control-plane DNS answer before constructing an authenticated fetch", async () => {
    const fetcher = (async () => {
      throw new Error("must not fetch");
    }) as typeof fetch;
    const adapter = new MonidAdapter({
      config: monidConfig(),
      fetcher,
      resolveHostname: async () => ["10.0.0.5"]
    });
    await expect(adapter.inspect()).rejects.toMatchObject({ code: "MONID_PARSE_FAILED" });
  });

  it("prohibits control-plane redirects instead of forwarding Authorization", async () => {
    const requests: Array<{ url: string; authorization: string | null; redirect?: RequestRedirect }> = [];
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({
        url: input.toString(),
        authorization: new Headers(init?.headers).get("authorization"),
        redirect: init?.redirect
      });
      return new Response(null, {
        status: 307,
        headers: { location: "https://attacker.example/collect" }
      });
    }) as typeof fetch;
    const adapter = new MonidAdapter({
      config: monidConfig(),
      fetcher,
      resolveHostname: async () => ["93.184.216.34"]
    });
    await expect(adapter.inspect()).rejects.toMatchObject({ code: "MONID_PARSE_FAILED" });
    expect(requests).toEqual([{
      url: "https://api.monid.test/v1/inspect",
      authorization: "Bearer test-key",
      redirect: "manual"
    }]);
  });

  it("tags observed terminal provider failure but never an unknown polling timeout", async () => {
    const terminalAdapter = new MonidAdapter({
      config: monidConfig(),
      fetcher: withCredentialedInspect((async (input: URL | RequestInfo) => input.toString().endsWith("/v1/run")
        ? Response.json({ id: "run-terminal" })
        : Response.json({
            status: "FAILED",
            cost: { value: 0.001, currency: "USD" }
          })) as typeof fetch),
      sleep: async () => undefined,
      maxPolls: 1,
      resolveHostname: async () => ["93.184.216.34"]
    });
    await expect(terminalAdapter.parse({ fileUrl: "https://private-blob.test/source.pdf" }))
      .rejects.toMatchObject({
        terminalProviderFailure: true,
        providerRunId: "run-terminal",
        lifecycleStatus: "FAILED",
        costAmount: 0.001,
        costCurrency: "USD",
        costProvenance: {
          inspect_schema_sha256: inspectedContractSha256,
          value_unit: "currency_major"
        }
      });

    const pollingAdapter = new MonidAdapter({
      config: monidConfig(),
      fetcher: withCredentialedInspect((async (input: URL | RequestInfo) => input.toString().endsWith("/v1/run")
        ? Response.json({ id: "run-still-running" })
        : Response.json({ status: "RUNNING" })) as typeof fetch),
      sleep: async () => undefined,
      maxPolls: 1,
      resolveHostname: async () => ["93.184.216.34"]
    });
    try {
      await pollingAdapter.parse({ fileUrl: "https://private-blob.test/source.pdf" });
      throw new Error("expected timeout");
    } catch (error) {
      expect(error).toMatchObject({ code: "MONID_PARSE_FAILED", retryable: true });
      expect(error).not.toHaveProperty("terminalProviderFailure");
    }
  });

  it("rejects a changed inspect response before any paid run dispatch", async () => {
    const requests: string[] = [];
    const adapter = new MonidAdapter({
      config: monidConfig(),
      fetcher: (async (input: URL | RequestInfo) => {
        const url = input.toString();
        requests.push(url);
        if (url.endsWith("/v1/inspect")) {
          return Response.json({ ...inspectedContract, run_schema: { changed: true } });
        }
        throw new Error("paid run must not be dispatched");

      }) as typeof fetch,
      resolveHostname: async () => ["93.184.216.34"]
    });

    await expect(adapter.parse({ fileUrl: "https://private-blob.test/source.pdf" }))
      .rejects.toMatchObject({ code: "MONID_PARSE_FAILED" });
    expect(requests).toEqual(["https://api.monid.test/v1/inspect"]);
  });

  it("never manufactures terminal cost provenance without a validated inspect contract", async () => {
    const config = getConfig({
      NODE_ENV: "test",
      MONID_API_KEY: "test-key",
      MONID_API_BASE_URL: "https://api.monid.test",
      MONID_PARSE_PROVIDER: "context-dev",
      MONID_PARSE_ENDPOINT: "parse",
      MONID_COST_VALUE_PATH: "cost.value",
      MONID_COST_CURRENCY_PATH: "cost.currency",
      MONID_COST_VALUE_UNIT: "currency_major"
    });
    const adapter = new MonidAdapter({
      config,
      fetcher: (async (input: URL | RequestInfo) => input.toString().endsWith("/v1/run")
        ? Response.json({ id: "run-no-inspect" })
        : Response.json({ status: "FAILED", cost: { value: 0.25, currency: "USD" } })) as typeof fetch,
      sleep: async () => undefined,
      maxPolls: 1,
      resolveHostname: async () => ["93.184.216.34"]
    });

    const error = await adapter.parse({ fileUrl: "https://private-blob.test/source.pdf" })
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({ terminalProviderFailure: true, costAmount: 0.25 });
    expect(error).toHaveProperty("costProvenance", null);
  });
});
