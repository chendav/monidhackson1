import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEdmontonSampleResult, EDMONTON_SHA256, EDMONTON_SOURCE_URL } from "@/lib/fixtures/edmonton";

interface TestRunMetric {
  case_id: string;
  failure: { code: string } | null;
  cleanup: { attempted: boolean; confirmed: boolean };
  cost: { actual_micro_usd: number | null; estimated_micro_usd: number | null; total_micro_usd: number };
  [key: string]: unknown;
}

interface TestAggregateMetric {
  attempt_count: number;
  total_cost_micro_usd: number;
  [key: string]: unknown;
}

const runnerPromise = import(new URL("../../scripts/live-verify.mjs", import.meta.url).href) as Promise<{
  parseRuntimeOptions: (environment: Record<string, string | undefined>, now?: Date) => {
    baseUrl: string;
    campaignId: string;
    allowPaidLive: boolean;
    apiKey: string | null;
    monidApiKey: string | null;
    totalBudgetMicroUsd: number;
    declaredPerRunCapMicroUsd: number;
  };
  assertPublicProductionOrigin: (
    baseUrl: string,
    resolver?: (hostname: string) => Promise<string[]>
  ) => Promise<true>;
  readMonidWalletBalance: (
    apiKey: string,
    resolver?: (hostname: string) => Promise<string[]>,
    fetcher?: typeof fetch
  ) => Promise<number>;
  normalizeEvidenceText: (value: unknown) => string;
  verifySourceCitations: (
    analysis: Record<string, unknown>,
    documents: Array<Record<string, unknown>>,
    pages: Map<string, string[]>
  ) => { matched: number };
  validateMonidCostAccounting: (
    costs: Record<string, unknown>,
    expectedDocumentCount: number
  ) => number;
  validateAnalysisEnvelope: (
    analysis: Record<string, unknown>,
    expectedDocuments: Array<Record<string, unknown>>,
    pages: Map<string, string[]>,
    options?: { requireLiveCosts?: boolean }
  ) => Record<string, unknown>;
  validateEdmontonGolden: (
    analysis: Record<string, unknown>,
    document: { sha256: string }
  ) => { golden_checks: number; mandatory_active_count: number };
  summarizeAttemptCost: (
    costs: Record<string, unknown> | null,
    terminalReportedMicroUsd: number | null,
    declaredPerRunCapMicroUsd: number
  ) => {
    accountingComplete: boolean;
    reportedTotalMicroUsd: number | null;
    pessimisticReservedMicroUsd: number;
    totalMicroUsd: number;
  };
  assertSanitizedMetrics: (value: unknown) => true;
  buildRunCases: (manifest: { documents: Array<Record<string, unknown>> }) => Array<{
    caseId: string;
    packageId: string;
    body: { documents: Array<{ role: string; source: { type: string; url: string } }> };
    inputOrderScrambled: boolean;
    ingressMode: string;
  }>;
  criticalStructureFingerprint: (analysis: Record<string, unknown>) => string;
  runReadOnlyPreflight: (
    baseUrl: string,
    manifest: { documents: Array<Record<string, unknown>> },
    budgetPolicy: { declaredPerRunCapMicroUsd: number; totalBudgetMicroUsd: number },
    pages: Map<string, string[]>
  ) => Promise<Record<string, unknown>>;
  executeRunCase: (input: Record<string, unknown>) => Promise<TestRunMetric>;
  createRunWithRecovery: (input: Record<string, unknown>) => Promise<{
    status: number;
    payload: Record<string, unknown>;
    obtainedRunIds: string[];
  }>;
  materializeRunCaseInput: (input: Record<string, unknown>) => Promise<{
    body: { documents: Array<{ source: { type: string; sha256: string } }> };
    corsVerified: boolean;
    replayRejected: boolean;
  }>;
  aggregateMetrics: (metrics: { runs: TestRunMetric[] }) => TestAggregateMetric;
  verifyOfficialFixtures: (input: {
    manifestPath?: string;
    fixtureDirectory: string;
    pageTextExtractor?: (filePath: string) => Promise<string[]>;
  }) => Promise<{
    metrics: {
      document_count: number;
      bytes_verified: number;
      byte_lengths_verified: boolean;
      sha256_verified: boolean;
      physical_pages_verified: number;
    };
  }>;
}>;

const ids = [
  "edmonton-100022184-a",
  "cer-84084-26-0009-a-base",
  "cer-84084-26-0009-a-amendment-001",
  "cer-84084-26-0009-a-amendment-002",
  "cer-84084-26-0009-a-amendment-003"
] as const;

const filenames: Record<(typeof ids)[number], string> = {
  "edmonton-100022184-a": "edmonton.pdf",
  "cer-84084-26-0009-a-base": "cer-main.pdf",
  "cer-84084-26-0009-a-amendment-001": "cer-amendment-001.pdf",
  "cer-84084-26-0009-a-amendment-002": "cer-amendment-002.pdf",
  "cer-84084-26-0009-a-amendment-003": "cer-amendment-003.pdf"
};

function safeEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    RFP_XRAY_BASE_URL: "https://rfp-xray.vercel.app",
    RFP_XRAY_FIXTURE_DIR: ".",
    ...overrides
  };
}

function sourcePagesFromAnalysis(analysis: Record<string, unknown>) {
  const pages = Array.from({ length: 55 }, () => "");
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.evidence_quote === "string" && Number.isInteger(record.pdf_page_1based)) {
      const page = Number(record.pdf_page_1based) - 1;
      if (page >= 0 && page < pages.length) pages[page] += ` ${record.evidence_quote}`;
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(analysis);
  return new Map([[EDMONTON_SHA256, pages]]);
}

function manifestDocuments() {
  return ids.map((id, index) => ({
    id,
    role: id.includes("amendment") ? "amendment" : "base",
    url: `https://canadabuys.canada.ca/fixtures/${index}.pdf`,
    sha256: String(index + 1).padStart(64, "0"),
    bytes: index + 1,
    physical_pages: index + 1
  }));
}

function analysisProjection(page = 43, status = "active", prose = "first wording") {
  const citation = {
    document_sha256: "a".repeat(64),
    pdf_page_1based: page,
    printed_page_label: "not fingerprinted",
    section: "not fingerprinted",
    evidence_quote: prose,
    verified: true,
    verification_method: "normalized"
  };
  return {
    package_completeness: "unverified",
    document_manifest: [{
      role: "base",
      sha256: "a".repeat(64),
      pages: 55,
      amendment_number: null,
      status: "active",
      cleanup_status: "deleted"
    }],
    summary: {
      solicitation_number: "100022184-A",
      closing_date: "2023-06-19T14:00:00-04:00",
      current_selection_method: "Lowest evaluated price"
    },
    claims: [{ claim_id: "volatile-id", claim_type: "source", status, claim_text: prose, citations: [citation] }],
    requirements: [],
    evaluation: {
      mandatory_gate: true,
      rated_threshold: null,
      technical_weight: null,
      financial_weight: null,
      selection_method: "Lowest evaluated price",
      citations: [citation]
    },
    risks: [],
    conflicts: [],
    quality: {
      pages_total: 55,
      pages_covered: 1,
      critical_claims: 1,
      critical_claims_cited: 1,
      citations_verified: 2,
      search_events: 0,
      follow_embedded_link_events: 0
    }
  };
}

describe("paid-live verifier safety policy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the paid gate closed unless the exact opt-in is present", async () => {
    const runner = await runnerPromise;
    const closed = runner.parseRuntimeOptions(safeEnvironment(), new Date("2026-09-03T12:00:00Z"));
    expect(closed).toMatchObject({
      baseUrl: "https://rfp-xray.vercel.app",
      campaignId: "release-2026-09-03",
      allowPaidLive: false,
      apiKey: null,
      monidApiKey: null,
      totalBudgetMicroUsd: 20_000_000,
      declaredPerRunCapMicroUsd: 2_000_000
    });

    const open = runner.parseRuntimeOptions(safeEnvironment({
      RFP_XRAY_ALLOW_PAID_LIVE: "true",
      RFP_XRAY_API_KEY: "kept-only-in-memory",
      MONID_API_KEY: "monid-only-in-memory"
    }));
    expect(open.allowPaidLive).toBe(true);
    expect(open.apiKey).toBe("kept-only-in-memory");
    expect(open.monidApiKey).toBe("monid-only-in-memory");
  });

  it("rejects unsafe origins and budgets beyond the declared competition cap", async () => {
    const runner = await runnerPromise;
    expect(() => runner.parseRuntimeOptions(safeEnvironment({
      RFP_XRAY_BASE_URL: "https://user:password@rfp-xray.vercel.app"
    }))).toThrow("BASE_URL_NOT_APPROVED_PRODUCTION_ORIGIN");
    expect(() => runner.parseRuntimeOptions(safeEnvironment({
      RFP_XRAY_BASE_URL: "http://rfp-xray.vercel.app"
    }))).toThrow("BASE_URL_NOT_APPROVED_PRODUCTION_ORIGIN");
    expect(() => runner.parseRuntimeOptions(safeEnvironment({
      RFP_XRAY_BASE_URL: "https://preview-rfp-xray.vercel.app"
    }))).toThrow("BASE_URL_NOT_APPROVED_PRODUCTION_ORIGIN");
    expect(() => runner.parseRuntimeOptions(safeEnvironment({
      RFP_XRAY_LIVE_BUDGET_USD: "20.000001"
    }))).toThrow("TOTAL_BUDGET_INVALID");
    expect(() => runner.parseRuntimeOptions(safeEnvironment({
      RFP_XRAY_LIVE_PER_RUN_CAP_USD: "3.000001"
    }))).toThrow("PER_RUN_CAP_INVALID");
  });

  it("requires public DNS before any production credential can be sent", async () => {
    const runner = await runnerPromise;
    await expect(runner.assertPublicProductionOrigin(
      "https://rfp-xray.vercel.app",
      async () => ["127.0.0.1"]
    )).rejects.toThrow("BASE_URL_DNS_NOT_PUBLIC");
    await expect(runner.assertPublicProductionOrigin(
      "https://rfp-xray.vercel.app",
      async () => ["76.76.21.21"]
    )).resolves.toBe(true);
  });

  it("reads the documented Monid wallet contract without following redirects", async () => {
    const runner = await runnerPromise;
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init).toMatchObject({ method: "GET", redirect: "manual", credentials: "omit" });
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer wallet-secret");
      return Response.json({ balance: { value: "12.345678", currency: "USD" } });
    }) as typeof fetch;
    await expect(runner.readMonidWalletBalance(
      "wallet-secret",
      async () => ["93.184.216.34"],
      fetcher
    )).resolves.toBe(12_345_678);
    expect(fetcher).toHaveBeenCalledOnce();

    const redirecting = vi.fn(async () => new Response(null, {
      status: 307,
      headers: { location: "https://attacker.example/" }
    })) as typeof fetch;
    await expect(runner.readMonidWalletBalance(
      "wallet-secret",
      async () => ["93.184.216.34"],
      redirecting
    )).rejects.toThrow("MONID_WALLET_REDIRECT_REJECTED");
  });

  it("refuses sensitive metric keys and credential-shaped values", async () => {
    const runner = await runnerPromise;
    expect(runner.assertSanitizedMetrics({ verdict: "pass", total_micro_usd: 10 })).toBe(true);
    expect(() => runner.assertSanitizedMetrics({ authorization: "redacted" })).toThrow("UNSAFE_METRIC_KEY");
    expect(() => runner.assertSanitizedMetrics({ nested: { evidence_quote: "redacted" } })).toThrow("UNSAFE_METRIC_KEY");
    expect(() => runner.assertSanitizedMetrics({ value: "Bearer credential" })).toThrow("UNSAFE_METRIC_VALUE");
    expect(() => runner.assertSanitizedMetrics({ value: "postgresql://host/database" })).toThrow("UNSAFE_METRIC_VALUE");
    expect(() => runner.assertSanitizedMetrics({ value: "%PDF-1.7" })).toThrow("UNSAFE_METRIC_VALUE");
    expect(() => runner.assertSanitizedMetrics({ value: "```text" })).toThrow("UNSAFE_METRIC_VALUE");
    expect(() => runner.assertSanitizedMetrics({ value: "# heading" })).toThrow("UNSAFE_METRIC_VALUE");
    expect(() => runner.assertSanitizedMetrics({ value: "**quoted evidence**" })).toThrow("UNSAFE_METRIC_VALUE");
    expect(() => runner.assertSanitizedMetrics({ value: "JVBERi0xLjcK" })).toThrow("UNSAFE_METRIC_VALUE");
    expect(() => runner.assertSanitizedMetrics({ value: "sk-proj-secretmaterial" })).toThrow("UNSAFE_METRIC_VALUE");
    expect(() => runner.assertSanitizedMetrics({ value: "?sv=1&sig=signed" })).toThrow("UNSAFE_METRIC_VALUE");
  });

  it("independently matches each physical-page quote instead of trusting verified=true", async () => {
    const runner = await runnerPromise;
    const analysis = analysisProjection() as unknown as Record<string, unknown>;
    const document = { sha256: "a".repeat(64) };
    const pages = Array.from({ length: 55 }, () => "");
    pages[42] = runner.normalizeEvidenceText("Prefix first wording suffix");
    expect(runner.verifySourceCitations(analysis, [document], new Map([[document.sha256, pages]])))
      .toMatchObject({ matched: 2 });

    pages[42] = "unrelated source text";
    expect(() => runner.verifySourceCitations(analysis, [document], new Map([[document.sha256, pages]])))
      .toThrow("INDEPENDENT_SOURCE_QUOTE_MISMATCH");
  });

  it("uses the real presign contract, CORS preflight, byte-exact PUT, and one-time replay fence", async () => {
    const runner = await runnerPromise;
    const directory = await mkdtemp(path.join(tmpdir(), "rfp-xray-signed-put-"));
    try {
      const bytes = Buffer.from("%PDF-test-byte-exact");
      await writeFile(path.join(directory, "edmonton.pdf"), bytes);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      let putCount = 0;
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/v1/uploads/presign")) {
          expect(method).toBe("POST");
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer app-api-key");
          return Response.json({
            blob_path: "incoming/opaque/source.pdf",
            upload_url: "https://rfp-xray-private.example/source.pdf?opaque=1",
            expires_at: new Date(Date.now() + 300_000).toISOString(),
            method: "PUT",
            headers: {
              "content-type": "application/pdf",
              "content-length": String(bytes.byteLength),
              "if-none-match": "*"
            }
          }, { status: 201 });
        }
        if (method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              "access-control-allow-origin": "https://rfp-xray.vercel.app",
              "access-control-allow-methods": "PUT",
              "access-control-allow-headers": "content-type,if-none-match"
            }
          });
        }
        if (method === "PUT") {
          putCount += 1;
          expect(Buffer.from(init?.body as Buffer)).toEqual(bytes);
          expect(new Headers(init?.headers).get("if-none-match")).toBe("*");
          return new Response(null, {
            status: putCount === 1 ? 200 : 412,
            headers: { "access-control-allow-origin": "https://rfp-xray.vercel.app" }
          });
        }
        throw new Error(`Unexpected ${method} ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await runner.materializeRunCaseInput({
        runCase: {
          ingressMode: "signed_put",
          expectedDocuments: [{
            id: "edmonton-100022184-a",
            role: "base",
            sha256,
            bytes: bytes.byteLength
          }]
        },
        baseUrl: "https://rfp-xray.vercel.app",
        apiKey: "app-api-key",
        fixtureDirectory: directory,
        signal: new AbortController().signal
      });
      expect(result).toMatchObject({
        corsVerified: true,
        replayRejected: true,
        body: { documents: [{ source: { type: "upload", sha256 } }] }
      });
      expect(putCount).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires inspect-bound actual Monid cost and rejects unknown or failed attempts", async () => {
    const runner = await runnerPromise;
    const event = {
      provider: "monid",
      operation: "context_dev_parse",
      status: "succeeded",
      actual_micro_usd: 4_500,
      estimated_micro_usd: null,
      latency_ms: 10,
      retry_of: null,
      cost_provenance: {
        kind: "credentialed_inspect",
        inspect_schema_sha256: "a".repeat(64),
        value_path: "cost.value",
        currency_path: "cost.currency",
        value_unit: "currency_major",
        source_value: 0.0045,
        source_currency: "USD"
      }
    };
    expect(runner.validateMonidCostAccounting({
      events: [event],
      includes_failed_attempts: false
    }, 1)).toBe(4_500);
    expect(() => runner.validateMonidCostAccounting({
      events: [{ ...event, cost_provenance: null }],
      includes_failed_attempts: false
    }, 1)).toThrow("MONID_COST_PROVENANCE_REQUIRED");
    expect(() => runner.validateMonidCostAccounting({
      events: [{ ...event, status: "failed" }],
      includes_failed_attempts: true
    }, 1)).toThrow("FAILED_PROVIDER_ATTEMPT_PRESENT");
    expect(() => runner.validateMonidCostAccounting({
      events: [{ ...event, status: "pending" }],
      includes_failed_attempts: false
    }, 1)).toThrow("INCOMPLETE_PROVIDER_ATTEMPT_PRESENT");
    expect(() => runner.validateMonidCostAccounting({
      events: [{ ...event, status: "unexpected" }],
      includes_failed_attempts: false
    }, 1)).toThrow("INCOMPLETE_PROVIDER_ATTEMPT_PRESENT");
  });

  it("requires server-reported hard budget limits before any paid phase", async () => {
    const runner = await runnerPromise;
    const sample = createEdmontonSampleResult();
    const requiredPaths = [
      "/api/v1/uploads/presign", "/api/v1/runs", "/api/v1/runs/{run_id}",
      "/api/v1/runs/{run_id}/analysis", "/api/v1/runs/{run_id}/questions",
      "/api/v1/samples/edmonton", "/api/openapi.json", "/api/health"
    ];
    const health = {
      status: "ok",
      version: "1.0",
      mode: "live",
      dependencies: {
        database: "ready",
        neon_capacity: "attested",
        maintenance: "fresh",
        private_storage: "attested",
        workflow: "attested_300s",
        monid: "actively_verified",
        openai: "actively_verified"
      },
      storage_provider: "railway_s3",
      storage_safety: "current",
      limits: { max_run_cost_micro_usd: 2_000_000, daily_cost_cap_micro_usd: 20_000_000 },
      missing: [],
      source_scope: "document_only",
      provider_retention: "context_dev_zdr_unavailable_artifact_expiry_observed_7d"
    };
    const openapi = {
      openapi: "3.1.0",
      paths: Object.fromEntries(requiredPaths.map((item) => [item, {}])),
      components: { securitySchemes: { BearerAuth: {} } }
    };
    const responses = new Map<string, unknown>([
      ["/api/health", health],
      ["/api/openapi.json", openapi],
      ["/api/v1/samples/edmonton", sample]
    ]);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBeUndefined();
      const body = responses.get(new URL(String(input)).pathname);
      return Response.json(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const manifest = {
      documents: [{
        id: "edmonton-100022184-a",
        role: "base",
        url: EDMONTON_SOURCE_URL,
        sha256: EDMONTON_SHA256,
        bytes: 1_726_637,
        physical_pages: 55
      }]
    };

    const sourcePages = sourcePagesFromAnalysis(sample as unknown as Record<string, unknown>);
    await expect(runner.runReadOnlyPreflight("https://rfp-xray.example", manifest, {
      declaredPerRunCapMicroUsd: 2_000_000,
      totalBudgetMicroUsd: 20_000_000
    }, sourcePages)).resolves.toMatchObject({
      health: {
        server_max_run_cost_micro_usd: 2_000_000,
        server_daily_cost_cap_micro_usd: 20_000_000
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    responses.set("/api/health", { ...health, provider_retention: "unknown" });
    await expect(runner.runReadOnlyPreflight("https://rfp-xray.example", manifest, {
      declaredPerRunCapMicroUsd: 2_000_000,
      totalBudgetMicroUsd: 20_000_000
    }, sourcePages)).rejects.toThrow("HEALTH_NOT_LIVE_READY");

    responses.set("/api/health", { ...health, limits: undefined });
    await expect(runner.runReadOnlyPreflight("https://rfp-xray.example", manifest, {
      declaredPerRunCapMicroUsd: 2_000_000,
      totalBudgetMicroUsd: 20_000_000
    }, sourcePages)).rejects.toThrow("HEALTH_LIMITS_MISSING");
  });

  it("validates complete and partial cost coverage and pessimistically reserves partial ledgers", async () => {
    const runner = await runnerPromise;
    const sample = createEdmontonSampleResult() as unknown as Record<string, unknown>;
    const expectedDocuments = [{ sha256: EDMONTON_SHA256, role: "base", physical_pages: 55 }];
    const sourcePages = sourcePagesFromAnalysis(sample);

    const partial = structuredClone(sample);
    const partialCosts = partial.costs as Record<string, unknown>;
    expect(runner.validateAnalysisEnvelope(
      partial,
      expectedDocuments,
      sourcePages,
      { requireLiveCosts: false }
    ).costs).toMatchObject({ completeness: "partial", known_subtotal_micro_usd: 0 });
    expect(runner.summarizeAttemptCost(partialCosts, 0, 2_000_000)).toEqual({
      accountingComplete: false,
      reportedTotalMicroUsd: 0,
      pessimisticReservedMicroUsd: 2_000_000,
      totalMicroUsd: 2_000_000
    });

    const complete = structuredClone(sample);
    const pricedProviders = ["monid", "openai", "railway_s3", "vercel", "neon"];
    complete.costs = {
      currency: "USD",
      events: pricedProviders.map((provider, index) => ({
        provider,
        operation: "release accounting",
        status: "succeeded",
        actual_micro_usd: index + 1,
        estimated_micro_usd: null,
        latency_ms: 1,
        retry_of: null
      })),
      completeness: "complete",
      unpriced_providers: [],
      not_applicable_providers: ["vercel_blob"],
      actual_micro_usd: 15,
      estimated_micro_usd: 0,
      known_subtotal_micro_usd: 15,
      total_micro_usd: 15,
      includes_failed_attempts: false
    };
    expect(runner.validateAnalysisEnvelope(
      complete,
      expectedDocuments,
      sourcePages,
      { requireLiveCosts: false }
    ).costs).toMatchObject({ completeness: "complete", known_subtotal_micro_usd: 15 });
    expect(runner.summarizeAttemptCost(complete.costs as Record<string, unknown>, 15, 2_000_000)).toEqual({
      accountingComplete: true,
      reportedTotalMicroUsd: 15,
      pessimisticReservedMicroUsd: 0,
      totalMicroUsd: 15
    });

    const malformedTotal = structuredClone(partial);
    (malformedTotal.costs as Record<string, unknown>).known_subtotal_micro_usd = 1;
    expect(() => runner.validateAnalysisEnvelope(
      malformedTotal,
      expectedDocuments,
      sourcePages,
      { requireLiveCosts: false }
    )).toThrow("ANALYSIS_COST_INVALID");

    const overlapping = structuredClone(complete);
    (overlapping.costs as Record<string, unknown>).unpriced_providers = ["monid"];
    (overlapping.costs as Record<string, unknown>).completeness = "partial";
    expect(() => runner.validateAnalysisEnvelope(
      overlapping,
      expectedDocuments,
      sourcePages,
      { requireLiveCosts: false }
    )).toThrow("ANALYSIS_COST_INVALID");

    const missingProviders = structuredClone(partial);
    (missingProviders.costs as Record<string, unknown>).unpriced_providers = ["monid"];
    expect(() => runner.validateAnalysisEnvelope(
      missingProviders,
      expectedDocuments,
      sourcePages,
      { requireLiveCosts: false }
    )).toThrow("ANALYSIS_COST_INVALID");

    const activeProviderMarkedNotApplicable = structuredClone(complete);
    const activeCosts = activeProviderMarkedNotApplicable.costs as Record<string, unknown>;
    activeCosts.events = (activeCosts.events as Array<Record<string, unknown>>)
      .filter((event) => event.provider !== "openai");
    activeCosts.not_applicable_providers = ["openai", "vercel_blob"];
    activeCosts.actual_micro_usd = 13;
    activeCosts.known_subtotal_micro_usd = 13;
    activeCosts.total_micro_usd = 13;
    expect(() => runner.validateAnalysisEnvelope(
      activeProviderMarkedNotApplicable,
      expectedDocuments,
      sourcePages,
      { requireLiveCosts: false }
    )).toThrow("ANALYSIS_COST_INVALID");
  });

  it("cleans a syntactically valid run id even when create metadata is malformed", async () => {
    const runner = await runnerPromise;
    const runId = "11111111-1111-4111-8111-111111111111";
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (method === "POST") {
        return Response.json({ run_id: runId, status: "queued", status_url: "/malformed" }, { status: 202 });
      }
      if (method === "DELETE" && url.endsWith(`/api/v1/runs/${runId}`)) return new Response(null, { status: 204 });
      return Response.json({}, { status: 500 });
    }));
    const metric = await runner.executeRunCase({
      runCase: {
        caseId: "edmonton-01",
        packageId: "edmonton",
        expectedDocuments: [],
        body: { documents: [] },
        qaPrompt: "unused",
        inputOrderScrambled: false
      },
      attemptIndex: 1,
      baseUrl: "https://rfp-xray.example",
      apiKey: "in-memory-only",
      campaignId: "test-campaign",
      options: {
        runTimeoutMs: 100,
        pollIntervalMs: 1,
        cleanupTimeoutMs: 100,
        declaredPerRunCapMicroUsd: 2_000_000
      },
      signal: new AbortController().signal
    });
    expect(metric.failure).toMatchObject({ code: "CREATE_RESPONSE_INVALID" });
    expect(metric.cleanup).toMatchObject({ attempted: true, confirmed: true });
    expect(metric).toMatchObject({
      obtained_run_count: 1,
      cost_accounting_complete: false,
      cost: { total_micro_usd: 2_000_000, pessimistic_reserved_micro_usd: 2_000_000 }
    });
    expect(calls.map((item) => item.method)).toEqual(["POST", "DELETE"]);
  });

  it("retains and cleans run ids observed on an earlier retryable response", async () => {
    const runner = await runnerPromise;
    const runId = "33333333-3333-4333-8333-333333333333";
    let postCount = 0;
    const methods: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      if (method === "POST") {
        postCount += 1;
        if (postCount === 1) {
          return Response.json({ run_id: runId, error: { code: "MODEL_UNAVAILABLE" } }, { status: 500 });
        }
        throw new Error("synthetic network failure");
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({}, { status: 500 });
    }));
    const metric = await runner.executeRunCase({
      runCase: {
        caseId: "edmonton-01",
        packageId: "edmonton",
        expectedDocuments: [],
        body: { documents: [] },
        qaPrompt: "unused",
        inputOrderScrambled: false
      },
      attemptIndex: 1,
      baseUrl: "https://rfp-xray.example",
      apiKey: "in-memory-only",
      campaignId: "test-campaign",
      options: {
        runTimeoutMs: 100,
        pollIntervalMs: 1,
        cleanupTimeoutMs: 100,
        declaredPerRunCapMicroUsd: 2_000_000
      },
      signal: new AbortController().signal
    });
    expect(methods).toEqual(["POST", "POST", "POST", "POST", "POST", "DELETE"]);
    expect(metric).toMatchObject({
      obtained_run_count: 1,
      cost_accounting_complete: false,
      cleanup: { attempted: true, confirmed: true, run_count: 1 },
      cost: { total_micro_usd: 2_000_000 }
    });
  });

  it("recovers a lost create response with the identical idempotency key and body", async () => {
    const runner = await runnerPromise;
    const runId = "44444444-4444-4444-8444-444444444444";
    const observed: Array<{ body: string; key: string | null }> = [];
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      observed.push({
        body: String(init?.body),
        key: new Headers(init?.headers).get("idempotency-key")
      });
      attempt += 1;
      if (attempt === 1) throw new Error("response lost after durable admission");
      return Response.json({
        run_id: runId,
        status: "queued",
        status_url: `/api/v1/runs/${runId}`
      }, { status: 200 });
    }));
    const body = { documents: [{ role: "base", source: { type: "url", url: "https://canadabuys.canada.ca/a.pdf" } }] };
    const recovered = await runner.createRunWithRecovery({
      baseUrl: "https://rfp-xray.vercel.app",
      apiKey: "app-api-key",
      idempotencyKey: "stable-idempotency-key",
      body,
      signal: new AbortController().signal
    });
    expect(recovered).toMatchObject({ status: 200, obtainedRunIds: [runId] });
    expect(observed).toHaveLength(2);
    expect(new Set(observed.map((item) => item.body))).toEqual(new Set([JSON.stringify(body)]));
    expect(new Set(observed.map((item) => item.key))).toEqual(new Set(["stable-idempotency-key"]));
  });

  it("retains observed over-cap cost and counts every attempt in aggregate spend", async () => {
    const runner = await runnerPromise;
    const runId = "22222222-2222-4222-8222-222222222222";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return Response.json({
          run_id: runId,
          status: "queued",
          status_url: `/api/v1/runs/${runId}`
        }, { status: 202 });
      }
      if (method === "GET") {
        return Response.json({
          run_id: runId,
          status: "extracting",
          stage: "extracting",
          progress: 70,
          cleanup_confirmed: false,
          cost_micro_usd: 2_000_001,
          cost_accounting_status: "estimated_complete"
        });
      }
      return new Response(null, { status: 204 });
    }));
    const metric = await runner.executeRunCase({
      runCase: {
        caseId: "edmonton-01",
        packageId: "edmonton",
        expectedDocuments: [],
        body: { documents: [] },
        qaPrompt: "unused",
        inputOrderScrambled: false
      },
      attemptIndex: 1,
      baseUrl: "https://rfp-xray.example",
      apiKey: "in-memory-only",
      campaignId: "test-campaign",
      options: {
        runTimeoutMs: 100,
        pollIntervalMs: 1,
        cleanupTimeoutMs: 100,
        declaredPerRunCapMicroUsd: 2_000_000
      },
      signal: new AbortController().signal
    });
    expect(metric.failure).toMatchObject({ code: "DECLARED_PER_RUN_CAP_EXCEEDED" });
    expect(metric.cost).toMatchObject({
      actual_micro_usd: null,
      estimated_micro_usd: null,
      reported_total_micro_usd: 2_000_001,
      pessimistic_reserved_micro_usd: 2_000_001,
      total_micro_usd: 2_000_001
    });
    expect(metric.cleanup.confirmed).toBe(true);
    const aggregate = runner.aggregateMetrics({ runs: [metric, { ...metric, case_id: "edmonton-02" }] });
    expect(aggregate).toMatchObject({ attempt_count: 2, total_cost_micro_usd: 4_000_002 });
  });
});

describe("paid-live verifier deterministic campaign", () => {
  const officialFixtureDirectory = process.env.RFP_XRAY_FIXTURE_DIR;

  it("builds ten Edmonton runs followed by one deliberately shuffled CER package", async () => {
    const runner = await runnerPromise;
    const cases = runner.buildRunCases({ documents: manifestDocuments() });
    expect(cases).toHaveLength(11);
    expect(cases.slice(0, 10).map((item) => item.caseId)).toEqual([
      "edmonton-01", "edmonton-02", "edmonton-03", "edmonton-04", "edmonton-05",
      "edmonton-06", "edmonton-07", "edmonton-08", "edmonton-09", "edmonton-10"
    ]);
    expect(cases[10]).toMatchObject({ caseId: "cer-01", packageId: "cer", inputOrderScrambled: true });
    expect(cases[10].body.documents.map((item) => item.role)).toEqual([
      "amendment", "base", "amendment", "amendment"
    ]);
    expect(cases.filter((item) => item.ingressMode === "official_url").every((item) =>
      item.body.documents.every((document) =>
      document.source.type === "url" && document.source.url.startsWith("https://canadabuys.canada.ca/")
    ))).toBe(true);
    expect(cases[9]).toMatchObject({ caseId: "edmonton-10", ingressMode: "signed_put" });
    expect(cases.filter((item) => item.ingressMode === "signed_put")).toHaveLength(1);
  });

  it("scopes the Edmonton M1-M4 gate to the mandatory-criteria table", async () => {
    const runner = await runnerPromise;
    const analysis = createEdmontonSampleResult();
    analysis.requirements.push({
      id: "integrity-documentation",
      category: "mandatory",
      status: "active",
      text: "The Bidder must provide the required documentation, as applicable.",
      evidence_needed: null,
      consequence: null,
      citations: [{
        document_sha256: EDMONTON_SHA256,
        document_name: "edmonton-100022184-A.pdf",
        source_url: EDMONTON_SOURCE_URL,
        pdf_page_1based: 15,
        printed_page_label: "15 of 47",
        section: "5.2.1",
        evidence_quote: "The Bidder must provide the required documentation, as applicable.",
        verified: true,
        verification_method: "exact"
      }]
    });

    expect(runner.validateEdmontonGolden(
      analysis as unknown as Record<string, unknown>,
      { sha256: EDMONTON_SHA256 }
    )).toMatchObject({ golden_checks: 7, mandatory_active_count: 4 });
  });

  it("rejects any additional Edmonton conflict beyond the audited Annex D/E conflict", async () => {
    const runner = await runnerPromise;
    const analysis = createEdmontonSampleResult();
    analysis.conflicts.push({
      id: "false-delivery-conflict",
      topic: "delivery",
      status: "conflicted",
      candidate_values: ["2 business days", "3 business days"],
      safe_answer: "Clarification is required.",
      citations: [analysis.requirements[0].citations[0], analysis.requirements[1].citations[0]]
    });

    expect(() => runner.validateEdmontonGolden(
      analysis as unknown as Record<string, unknown>,
      { sha256: EDMONTON_SHA256 }
    )).toThrow(/EDMONTON_ANNEX_CONFLICT_GATE_FAILED/);
  });

  it("fingerprints critical structure and physical pages, not volatile prose or record ids", async () => {
    const runner = await runnerPromise;
    const baseline = runner.criticalStructureFingerprint(analysisProjection());
    const reworded = analysisProjection(43, "active", "different but equally grounded wording");
    reworded.claims[0].claim_id = "another-volatile-id";
    expect(runner.criticalStructureFingerprint(reworded)).toBe(baseline);
    expect(runner.criticalStructureFingerprint(analysisProjection(42))).not.toBe(baseline);
    expect(runner.criticalStructureFingerprint(analysisProjection(43, "superseded"))).not.toBe(baseline);
    const changedNumber = analysisProjection(43, "active", "The threshold is 51/94.");
    expect(runner.criticalStructureFingerprint(changedNumber)).not.toBe(baseline);
    type ProjectionConflict = {
      status: string;
      candidate_values: string[];
      safe_answer: string;
      citations: ReturnType<typeof analysisProjection>["claims"][number]["citations"];
    };
    const withConflict = analysisProjection() as unknown as
      Omit<ReturnType<typeof analysisProjection>, "conflicts"> & { conflicts: ProjectionConflict[] };
    withConflict.conflicts = [{
      status: "conflicted",
      candidate_values: ["2050", "2055"],
      safe_answer: "Clarification is required.",
      citations: withConflict.claims[0].citations
    }];
    const changedCandidate = structuredClone(withConflict);
    changedCandidate.conflicts[0].candidate_values = ["2050", "2060"];
    const changedSafeAnswer = structuredClone(withConflict);
    changedSafeAnswer.conflicts[0].safe_answer = "No clarification is required.";
    expect(runner.criticalStructureFingerprint(changedCandidate))
      .not.toBe(runner.criticalStructureFingerprint(withConflict));
    expect(runner.criticalStructureFingerprint(changedSafeAnswer))
      .not.toBe(runner.criticalStructureFingerprint(withConflict));
  });

  it("streams all five local fixtures through exact byte and SHA-256 checks", async () => {
    const runner = await runnerPromise;
    const directory = await mkdtemp(path.join(tmpdir(), "rfp-xray-live-verify-"));
    try {
      const fixtureDirectory = path.join(directory, "fixtures");
      await mkdir(fixtureDirectory);
      const documents = [];
      let totalBytes = 0;
      for (const [index, id] of ids.entries()) {
        const bytes = Buffer.from(`fixture-${index + 1}`);
        totalBytes += bytes.byteLength;
        await writeFile(path.join(fixtureDirectory, filenames[id]), bytes);
        documents.push({
          id,
          role: id.includes("amendment") ? "amendment" : "base",
          url: `https://canadabuys.canada.ca/fixtures/${index}.pdf`,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.byteLength,
          physical_pages: index + 1
        });
      }
      const manifestPath = path.join(directory, "manifest.json");
      await writeFile(manifestPath, JSON.stringify({
        verified_at: "2026-09-02",
        hash_algorithm: "sha256",
        documents
      }));

      const pageTextExtractor = async (filePath: string) => {
        const id = ids.find((candidate) => filenames[candidate] === path.basename(filePath));
        if (!id) return [];
        const pageCount = ids.indexOf(id) + 1;
        return Array.from({ length: pageCount }, (_, page) => `fixture ${id} page ${page + 1}`);
      };
      await expect(runner.verifyOfficialFixtures({
        manifestPath,
        fixtureDirectory,
        pageTextExtractor
      })).resolves.toMatchObject({
        metrics: {
          document_count: 5,
          bytes_verified: totalBytes,
          byte_lengths_verified: true,
          sha256_verified: true,
          physical_pages_verified: 15
        }
      });

      await writeFile(path.join(fixtureDirectory, "edmonton.pdf"), "tampered");
      await expect(runner.verifyOfficialFixtures({ manifestPath, fixtureDirectory, pageTextExtractor }))
        .rejects.toThrow(/FIXTURE_(?:BYTE_LENGTH|SHA256)_MISMATCH/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(!officialFixtureDirectory)(
    "independently matches the frozen Edmonton sample against the SHA-fixed physical PDF pages",
    async () => {
      const runner = await runnerPromise;
      const fixtures = await runner.verifyOfficialFixtures({
        fixtureDirectory: officialFixtureDirectory!
      }) as unknown as {
        sourcePagesBySha: Map<string, string[]>;
      };
      const sample = createEdmontonSampleResult() as unknown as Record<string, unknown>;
      expect(runner.verifySourceCitations(
        sample,
        [{ sha256: EDMONTON_SHA256 }],
        fixtures.sourcePagesBySha
      ).matched).toBeGreaterThan(12);
    }
  );
});
