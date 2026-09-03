import { expect, test } from "@playwright/test";

const REQUIRE_LIVE = process.env.PLAYWRIGHT_REQUIRE_LIVE === "1";
const EDMONTON_SHA256 = "2a769c87c80d5e958b0c99d0bd0107b34cfbeddb9bb0c15c2f2b3dc609adc9c6";

function assertExternalBaseUrl() {
  const configured = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (!configured) {
    throw new Error("PLAYWRIGHT_BASE_URL must be set for the production smoke suite.");
  }

  const target = new URL(configured);
  const hostname = target.hostname.toLowerCase();
  const loopback = hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || hostname.startsWith("127.");

  if (!(["http:", "https:"] as const).includes(target.protocol as "http:" | "https:") || loopback) {
    throw new Error("PLAYWRIGHT_BASE_URL must be an external HTTP(S) URL, not a loopback address.");
  }
}

test.describe("deployed RFP X-Ray smoke", () => {
  test.beforeAll(() => {
    assertExternalBaseUrl();
  });

  test("serves the public landing page", async ({ page }) => {
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Analyze a tender pack", level: 1 })).toBeVisible();
    await expect(page.getByText("Document-only. No search.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Edmonton sample" })).toBeVisible();
  });

  test("publishes the OpenAPI contract", async ({ request }) => {
    const response = await request.get("/api/openapi.json", { failOnStatusCode: false });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    const document = await response.json();
    expect(document.openapi).toBe("3.1.0");
    expect(document.info?.title).toBe("RFP X-Ray API");
    expect(document.paths).toEqual(expect.objectContaining({
      "/api/health": expect.any(Object),
      "/api/openapi.json": expect.any(Object),
      "/api/v1/samples/edmonton": expect.any(Object)
    }));
  });

  test("serves the SHA-bound Edmonton sample without a network mock", async ({ page, request }) => {
    const response = await request.get("/api/v1/samples/edmonton", { failOnStatusCode: false });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    const sample = await response.json();
    expect(sample).toEqual(expect.objectContaining({
      schema_version: "1.0",
      source_scope: "document_only",
      package_completeness: "unverified",
      summary: expect.objectContaining({
        title: "Repair & Maintenance on various File Bays",
        solicitation_number: "100022184-A"
      })
    }));
    expect(sample.document_manifest).toContainEqual(expect.objectContaining({
      role: "base",
      sha256: EDMONTON_SHA256,
      pages: 55,
      cleanup_status: "deleted"
    }));
    expect(sample.quality).toEqual(expect.objectContaining({
      search_events: 0,
      follow_embedded_link_events: 0
    }));

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open Edmonton sample" }).click();
    await expect(page.getByRole("heading", { name: "Repair & Maintenance on various File Bays", level: 1 })).toBeVisible();
    await expect(page.getByText("Verified sample", { exact: true })).toBeVisible();
  });

  test("reports deployment readiness truthfully", async ({ request }) => {
    const response = await request.get("/api/health", { failOnStatusCode: false });
    const health = await response.json();

    expect([200, 503]).toContain(response.status());
    expect(health.source_scope).toBe("document_only");
    expect(health.dependencies).toEqual(expect.objectContaining({
      database: expect.any(String),
      maintenance: expect.any(String),
      private_storage: expect.any(String),
      workflow: expect.any(String),
      monid: expect.any(String),
      openai: expect.any(String)
    }));
    expect(["railway_s3", "vercel_blob", "memory", "missing"]).toContain(health.storage_provider);
    expect(["current", "missing", "expired", "invalid", "not_applicable"]).toContain(health.storage_safety);
    expect(health.limits).toEqual(expect.objectContaining({
      max_run_cost_micro_usd: expect.any(Number),
      daily_cost_cap_micro_usd: expect.any(Number)
    }));
    expect(Array.isArray(health.missing)).toBe(true);

    if (REQUIRE_LIVE) {
      expect(response.status()).toBe(200);
      expect(health.status).toBe("ok");
      expect(health.mode).toBe("live");
      expect(health.missing).toEqual([]);
      expect(health.storage_safety).toBe("current");
      expect(health.dependencies).toEqual({
        database: "ready",
        neon_capacity: "attested",
        maintenance: "fresh",
        private_storage: "attested",
        workflow: "attested_300s",
        monid: "actively_verified",
        openai: "actively_verified"
      });
      return;
    }

    if (response.status() === 503) {
      expect(health.status).toBe("not_ready");
      expect(health.mode).toBe("unavailable");
      expect(health.missing.length).toBeGreaterThan(0);
    } else {
      expect(health.status).toBe("ok");
      expect(health.mode).toBe("live");
      expect(health.missing).toEqual([]);
    }
  });
});
