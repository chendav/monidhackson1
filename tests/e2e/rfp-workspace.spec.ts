import { expect, test, type Page } from "@playwright/test";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const SHA_BASE = "a".repeat(64);
const SHA_AMENDMENT = "b".repeat(64);

function citation(overrides: Record<string, unknown> = {}) {
  return {
    document_sha256: SHA_BASE,
    document_name: "100022184-A Request for Tender.pdf",
    source_url: "https://canadabuys.canada.ca/en/tender-opportunities/opportunity-listing/example",
    pdf_page_1based: 17,
    printed_page_label: "12",
    section: "Special Conditions",
    evidence_quote: "The Bidder shall submit the completed Security Requirements Check List identified as Annex E.",
    verified: true,
    verification_method: "exact",
    ...overrides,
  };
}

const sampleResult = {
  schema_version: "1.0",
  source_scope: "document_only",
  package_completeness: "verified",
  document_manifest: [
    {
      document_id: "33333333-3333-4333-8333-333333333333",
      role: "base",
      source_type: "url",
      source_name: "100022184-A Request for Tender.pdf",
      source_url: "https://canadabuys.canada.ca/en/tender-opportunities/opportunity-listing/example",
      sha256: SHA_BASE,
      pages: 55,
      language: "en",
      solicitation_number: "100022184-A",
      amendment_number: null,
      status: "active",
      cleanup_status: "deleted",
    },
    {
      document_id: "44444444-4444-4444-8444-444444444444",
      role: "amendment",
      source_type: "upload",
      source_name: "Amendment 001.pdf",
      source_url: null,
      sha256: SHA_AMENDMENT,
      pages: 2,
      language: "en",
      solicitation_number: "100022184-A",
      amendment_number: "001",
      status: "superseded",
      cleanup_status: "deleted",
    },
  ],
  summary: {
    title: "File Bay Repair & Maintenance",
    solicitation_number: "100022184-A",
    issuer: "City of Edmonton",
    closing_date: "2024-05-16T20:00:00.000Z",
    overview: "The City seeks repair and preventive maintenance services for file storage bay equipment.",
    scope: ["Inspect storage bay equipment", "Provide repairs and preventive maintenance"],
    submission_method: "Electronic submission through SAP Ariba",
    current_selection_method: "Lowest total tendered price",
  },
  claims: [
    {
      claim_id: "claim-active",
      claim_text: "Award is based on the lowest total tendered price from a compliant bidder.",
      claim_type: "source",
      status: "active",
      confidence: 0.99,
      citations: [citation({ pdf_page_1based: 9, section: "Evaluation" })],
      formula_and_inputs: null,
    },
    {
      claim_id: "claim-superseded",
      claim_text: "The original closing date was replaced by an amendment.",
      claim_type: "source",
      status: "superseded",
      confidence: 0.98,
      citations: [citation({ document_sha256: SHA_AMENDMENT, document_name: "Amendment 001.pdf", source_url: null, pdf_page_1based: 1 })],
      formula_and_inputs: null,
    },
    {
      claim_id: "claim-conflicted",
      claim_text: "The security checklist is identified as both Annex D and Annex E.",
      claim_type: "conflict",
      status: "conflicted",
      confidence: 1,
      citations: [citation()],
      formula_and_inputs: null,
    },
    {
      claim_id: "claim-review",
      claim_text: "The timing for the insurance certificate needs human review.",
      claim_type: "unknown",
      status: "needs_review",
      confidence: 0.61,
      citations: [citation({ pdf_page_1based: null, printed_page_label: null, verified: false, verification_method: "manual_required" })],
      formula_and_inputs: null,
    },
  ],
  requirements: [
    {
      id: "m3",
      category: "mandatory",
      status: "active",
      text: "Provide up to three project resources with the required experience.",
      evidence_needed: "Resource experience records",
      consequence: "Bid may be rejected",
      citations: [citation({ pdf_page_1based: 31, section: "M3" })],
    },
    {
      id: "price",
      category: "financial",
      status: "active",
      text: "Complete the blank pricing schedule. No source price is prefilled.",
      evidence_needed: "Completed pricing form",
      consequence: "Financial evaluation cannot be completed",
      citations: [citation({ pdf_page_1based: 46, section: "Pricing Schedule" })],
    },
    {
      id: "old-date",
      category: "submission",
      status: "superseded",
      text: "Submit by the original closing date.",
      evidence_needed: null,
      consequence: "Replaced by amendment",
      citations: [citation({ document_sha256: SHA_AMENDMENT, document_name: "Amendment 001.pdf", source_url: null, pdf_page_1based: 1 })],
    },
    {
      id: "security",
      category: "security",
      status: "conflicted",
      text: "Submit the required security checklist.",
      evidence_needed: "Issuer clarification on annex label",
      consequence: "Wrong form may be submitted",
      citations: [citation()],
    },
    {
      id: "insurance",
      category: "contractual",
      status: "needs_review",
      text: "Confirm when insurance evidence is due.",
      evidence_needed: "Human review",
      consequence: null,
      citations: [citation({ pdf_page_1based: null, printed_page_label: null, verified: false, verification_method: "manual_required" })],
    },
  ],
  evaluation: {
    mandatory_gate: true,
    rated_threshold: null,
    technical_weight: 0,
    financial_weight: 100,
    selection_method: "Lowest total tendered price",
    citations: [citation({ pdf_page_1based: 9, section: "Evaluation" })],
  },
  risks: [
    {
      id: "risk-annex",
      severity: "high",
      category: "Document consistency",
      finding: "The security checklist cross-reference is inconsistent.",
      impact: "A bidder could submit the wrong annex.",
      recommended_action: "Ask the City to confirm the required annex before close.",
      citations: [citation()],
    },
  ],
  conflicts: [
    {
      id: "conflict-annex",
      topic: "Security checklist annex",
      status: "conflicted",
      candidate_values: ["Annex D", "Annex E"],
      safe_answer: "The source package conflicts. Request issuer clarification.",
      citations: [citation(), citation({ pdf_page_1based: 49, section: "Annex E" })],
    },
  ],
  clarification_questions: ["Please confirm whether Annex D or Annex E is the required security checklist."],
  decision_readiness: "needs_clarification",
  blocking_unknowns: ["Pricing fields are blank in the issued schedule."],
  quality: {
    pages_total: 57,
    pages_covered: 57,
    critical_claims: 12,
    critical_claims_cited: 12,
    citations_verified: 18,
    unsupported_items_removed: 2,
    search_events: 0,
    follow_embedded_link_events: 0,
    warnings: ["One citation requires human review."],
  },
  costs: {
    currency: "USD",
    events: [
      {
        provider: "monid",
        operation: "context.dev parse",
        status: "succeeded",
        actual_micro_usd: 4210,
        estimated_micro_usd: null,
        latency_ms: 1842,
        retry_of: null,
      },
      {
        provider: "openai",
        operation: "structured extraction",
        status: "succeeded",
        actual_micro_usd: null,
        estimated_micro_usd: 9300,
        latency_ms: 2380,
        retry_of: null,
        estimation_basis: "Token-derived usage estimate; plan credits excluded.",
        pricing_source_url: "https://platform.openai.com/docs/pricing",
        pricing_observed_at: "2026-09-03T00:00:00.000Z",
      },
    ],
    completeness: "partial",
    unpriced_providers: ["railway_s3", "vercel", "neon"],
    not_applicable_providers: ["vercel_blob"],
    actual_micro_usd: 4210,
    estimated_micro_usd: 9300,
    known_subtotal_micro_usd: 13510,
    total_micro_usd: 13510,
    includes_failed_attempts: true,
  },
  generated_at: "2026-09-02T18:00:00.000Z",
  expires_at: "2026-09-03T18:00:00.000Z",
};

function status(statusValue: string, progress: number, cleanupConfirmed: boolean) {
  return {
    run_id: RUN_ID,
    status: statusValue,
    stage: statusValue === "cleanup_pending" ? "purging_source" : statusValue,
    progress,
    created_at: "2026-09-02T18:00:00.000Z",
    updated_at: "2026-09-02T18:00:01.000Z",
    expires_at: "2026-09-03T18:00:00.000Z",
    cleanup_confirmed: cleanupConfirmed,
    cost_micro_usd: 4210,
    cost_accounting_status: "estimated_complete",
    error: null,
  };
}

async function installTurnstileMock(page: Page, tokenDelayMs = 0) {
  await page.addInitScript(({ tokenDelayMs: callbackDelay }) => {
    type WidgetOptions = {
      action: string;
      execution: string;
      appearance: string;
      callback: (token: string) => void;
    };
    type WidgetRecord = { action: string; container: HTMLElement; options: WidgetOptions };
    const widgets = new Map<string, WidgetRecord>();
    const audit = {
      renders: [] as Array<{ id: string; action: string; execution: string; appearance: string; token?: string }>,
      executes: [] as string[],
      removes: [] as string[],
    };
    let widgetSequence = 0;
    let tokenSequence = 0;

    Object.defineProperty(window, "__RFP_XRAY_TURNSTILE_TEST_SITE_KEY__", { value: "1x00000000000000000000AA" });
    Object.defineProperty(window, "__turnstileAudit", { value: audit });
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      value: {
        ready(callback: () => void) {
          queueMicrotask(callback);
        },
        render(container: HTMLElement, options: WidgetOptions) {
          const id = `widget-${++widgetSequence}`;
          widgets.set(id, { action: options.action, container, options });
          audit.renders.push({ id, action: options.action, execution: options.execution, appearance: options.appearance });
          const accessibleMock = document.createElement("div");
          accessibleMock.setAttribute("role", "group");
          accessibleMock.setAttribute("aria-label", `Security challenge for ${options.action}`);
          accessibleMock.textContent = "Security challenge";
          container.replaceChildren(accessibleMock);
          return id;
        },
        execute(target: string | HTMLElement) {
          const widgetId = typeof target === "string"
            ? target
            : [...widgets.entries()].find(([, record]) => record.container === target)?.[0];
          if (!widgetId) throw new Error("Unknown widget target");
          const widget = widgets.get(widgetId);
          if (!widget) throw new Error(`Unknown widget ${widgetId}`);
          audit.executes.push(widgetId);
          const token = `token-${widget.action}-${++tokenSequence}`;
          const render = audit.renders.find((entry) => entry.id === widgetId);
          if (render) render.token = token;
          window.setTimeout(() => widget.options.callback(token), callbackDelay);
        },
        remove(widgetId: string) {
          const widget = widgets.get(widgetId);
          widget?.container.replaceChildren();
          widgets.delete(widgetId);
          audit.removes.push(widgetId);
        },
      },
    });
  }, { tokenDelayMs });
}

test("keeps source input and the verified sample useful in the first desktop viewport", async ({ page, isMobile }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Analyze a tender pack", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "CanadaBuys URL" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Repair & Maintenance on various File Bays", level: 2 })).toBeVisible();
  await expect(page.getByText("Document-only. No search.")).toBeVisible();
  await expect(page.getByText(/Context\.dev zero-data retention is not enabled.*seven-day artifact expiry/i)).toBeVisible();

  if (!isMobile) {
    await expect(page.getByRole("button", { name: "Analyze pack" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Open Edmonton sample" })).toBeInViewport();
  } else {
    await expect(page.getByRole("button", { name: "Preview Edmonton sample" })).toBeInViewport();
  }

  await page.getByRole("button", { name: "PDF pack" }).click();
  await expect(page.getByText("The server verifies the aggregate page limit.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose PDFs" })).toBeVisible();
});

test("loads the Edmonton result across desktop and mobile with trust labels intact", async ({ page }) => {
  await page.route("**/api/v1/samples/edmonton", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sampleResult) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Open Edmonton sample" }).click();

  await expect(page.getByRole("heading", { name: "File Bay Repair & Maintenance", level: 1 })).toBeVisible();
  await expect(page.getByText(/Frozen public sample generated.*retained separately/i)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Executive Brief" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Superseded", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Conflicted", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Needs review", { exact: true }).first()).toBeVisible();

  const evidence = page.locator("summary").filter({ hasText: "PDF page 17" }).first();
  await evidence.click();
  await expect(evidence.locator("..").getByText("The Bidder shall submit the completed Security Requirements Check List identified as Annex E.")).toBeVisible();
  const sourceLink = evidence.locator("..").getByRole("link", { name: "Open official source at PDF page 17" });
  await expect(sourceLink).toHaveAttribute("href", "https://canadabuys.canada.ca/en/tender-opportunities/opportunity-listing/example#page=17");
  await expect(sourceLink).toHaveAttribute("target", "_blank");

  const uploadedEvidence = page.locator("summary").filter({ hasText: /PDF page 1.*Amendment 001\.pdf/ }).first();
  await uploadedEvidence.click();
  await expect(uploadedEvidence.locator("..").getByText("Uploaded source was deleted after analysis. Verify PDF page 1 against your original file.")).toBeVisible();
  await expect(uploadedEvidence.locator("..").getByRole("link")).toHaveCount(0);

  await page.getByRole("tab", { name: "Evaluation & Pricing" }).click();
  await expect(page.getByText("Blank pricing fields remain unknown, never zero.")).toBeVisible();

  await page.getByRole("tab", { name: "Audit & Cost" }).click();
  await expect(page.getByRole("heading", { name: "Provider retention disclosure" })).toBeVisible();
  await expect(page.getByText(/Context\.dev zero-data retention is not enabled.*seven days/i)).toBeVisible();
  await expect(page.getByText(/This frozen public sample is retained separately; user-run structured output expires after 24 hours/i)).toBeVisible();
  await expect(page.getByText("App-controlled cleanup confirmed")).toBeVisible();
  await expect(page.getByText("No search", { exact: true })).toBeVisible();
  await expect(page.getByText("Actual", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Estimated", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Known provider subtotal", { exact: true })).toBeVisible();
  await expect(page.getByText(/Cost completeness:\s*Partial/i)).toBeVisible();
  await expect(page.getByText(/Unavailable per-run pricing: Railway S3, Vercel, Neon/i)).toBeVisible();
  const pricingSource = page.getByRole("link", { name: "Pricing source" });
  await expect(pricingSource).toHaveAttribute("href", "https://platform.openai.com/docs/pricing");
  await expect(pricingSource).toHaveAttribute("target", "_blank");
  await expect(page.getByText(/Not applicable to this architecture: Vercel Blob/i)).toBeVisible();
  await expect(page.getByText("Not reported", { exact: true })).toBeVisible();
});

test("shows loading and API error states without presenting success", async ({ page }) => {
  let releaseSample: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { releaseSample = resolve; });
  await page.route("**/api/v1/samples/edmonton", async (route) => {
    await gate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "MODEL_UNAVAILABLE", message: "The verified sample service is temporarily unavailable.", retryable: true, request_id: REQUEST_ID } }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open Edmonton sample" }).click();
  await expect(page.getByRole("heading", { name: "Loading the verified Edmonton sample" })).toBeVisible();
  await expect(page.getByText("Analysis ready")).toHaveCount(0);

  releaseSample?.();
  await expect(page.getByRole("heading", { name: "The pack could not be analyzed" })).toBeVisible();
  await expect(page.getByText("The verified sample service is temporarily unavailable.")).toBeVisible();
  await expect(page.getByText(`Request ID: ${REQUEST_ID}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "Review sources" }).click();
  await expect(page.getByRole("heading", { name: "Analyze a tender pack" })).toBeVisible();
});

test("holds a live result behind the cleanup confirmation gate", async ({ page }) => {
  await installTurnstileMock(page);
  let allowReady = false;
  await page.route("**/api/v1/runs", async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    expect(request.headers()["x-turnstile-token"]).toMatch(/^token-create_run-/);
    expect(request.postDataJSON()).toEqual({ documents: [{ role: "base", source: { type: "url", url: "https://canadabuys.canada.ca/tender.pdf" } }] });
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ run_id: RUN_ID, status: "queued", status_url: `/api/v1/runs/${RUN_ID}` }) });
  });
  await page.route(`**/api/v1/runs/${RUN_ID}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(allowReady ? status("ready", 100, true) : status("cleanup_pending", 62, false)) }));
  await page.route(`**/api/v1/runs/${RUN_ID}/analysis`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sampleResult) }));

  await page.goto("/");
  await page.getByLabel("CanadaBuys PDF URL").fill("https://canadabuys.canada.ca/tender.pdf");
  await page.getByRole("button", { name: "Analyze pack" }).click();
  await expect(page.getByRole("heading", { name: "Cleanup pending" })).toBeVisible();
  await expect(page.getByText("No result is shown until every app-controlled source deletion has a confirmation receipt.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "File Bay Repair & Maintenance", level: 1 })).toHaveCount(0);

  allowReady = true;
  await expect(page.getByRole("heading", { name: "File Bay Repair & Maintenance", level: 1 })).toBeVisible({ timeout: 5_000 });
});

test("uses a fresh action-bound Turnstile token for every guest mutation without leaking it to the Blob PUT", async ({ page }) => {
  await installTurnstileMock(page, 400);
  const protectedRequests: Array<{ method: string; path: string; token: string }> = [];
  const observedGets: Array<{ path: string; token?: string }> = [];
  const blobPutTokens: Array<string | undefined> = [];
  let presignSequence = 0;

  await page.route("**/api/v1/uploads/presign", async (route) => {
    const request = route.request();
    const token = request.headers()["x-turnstile-token"];
    presignSequence += 1;
    protectedRequests.push({ method: request.method(), path: new URL(request.url()).pathname, token });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        blob_path: `incoming/document-${presignSequence}.pdf`,
        upload_url: `http://localhost:3000/test-blob-upload/${presignSequence}`,
        expires_at: "2026-09-02T18:05:00.000Z",
        method: "PUT",
        headers: { "content-type": "application/pdf", "X-Turnstile-Token": "must-not-leak" },
      }),
    });
  });
  await page.route("**/test-blob-upload/*", async (route) => {
    blobPutTokens.push(route.request().headers()["x-turnstile-token"]);
    await route.fulfill({ status: 201, body: "" });
  });
  await page.route("**/api/v1/runs", async (route) => {
    const request = route.request();
    const token = request.headers()["x-turnstile-token"];
    protectedRequests.push({ method: request.method(), path: new URL(request.url()).pathname, token });
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ run_id: RUN_ID, status: "queued", status_url: `/api/v1/runs/${RUN_ID}` }) });
  });
  await page.route(`**/api/v1/runs/${RUN_ID}`, async (route) => {
    const request = route.request();
    if (request.method() === "DELETE") {
      const token = request.headers()["x-turnstile-token"];
      protectedRequests.push({ method: request.method(), path: new URL(request.url()).pathname, token });
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    observedGets.push({ path: new URL(request.url()).pathname, token: request.headers()["x-turnstile-token"] });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(status("ready", 100, true)) });
  });
  await page.route(`**/api/v1/runs/${RUN_ID}/analysis`, async (route) => {
    observedGets.push({ path: new URL(route.request().url()).pathname, token: route.request().headers()["x-turnstile-token"] });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sampleResult) });
  });
  await page.route(`**/api/v1/runs/${RUN_ID}/questions`, async (route) => {
    const request = route.request();
    const token = request.headers()["x-turnstile-token"];
    protectedRequests.push({ method: request.method(), path: new URL(request.url()).pathname, token });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ answerability: "answered", answer: "The completed pricing form is required.", citations: [citation()], warning: null }),
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("turnstile-facility")).toHaveAttribute("data-availability", "ready");
  await page.getByRole("button", { name: "PDF pack" }).click();
  await page.locator("#pdf-pack").setInputFiles([
    {
      name: "base.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% deterministic base browser fixture"),
    },
    {
      name: "amendment.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% deterministic amendment browser fixture"),
    },
  ]);
  await page.getByRole("button", { name: "Analyze 2 documents" }).click();
  await expect(page.getByTestId("turnstile-facility")).toHaveAttribute("role", "status");
  await expect(page.getByTestId("turnstile-facility").getByText(/securing an upload/i)).toBeVisible();
  await expect(page.getByRole("group", { name: "Security challenge for upload_presign" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "File Bay Repair & Maintenance", level: 1 })).toBeVisible();

  await page.getByRole("tab", { name: "Ask This RFP" }).click();
  await page.getByLabel("Question").fill("Which pricing form is required?");
  await page.getByRole("button", { name: "Ask this RFP" }).click();
  await expect(page.getByText("The completed pricing form is required.")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete analysis" }).click();
  await expect(page.getByRole("heading", { name: "Analyze a tender pack", level: 1 })).toBeVisible();

  expect(protectedRequests.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "POST /api/v1/uploads/presign",
    "POST /api/v1/uploads/presign",
    "POST /api/v1/runs",
    `POST /api/v1/runs/${RUN_ID}/questions`,
    `DELETE /api/v1/runs/${RUN_ID}`,
  ]);
  const tokens = protectedRequests.map(({ token }) => token);
  expect(new Set(tokens).size).toBe(5);
  expect(tokens[0]).toMatch(/^token-upload_presign-/);
  expect(tokens[1]).toMatch(/^token-upload_presign-/);
  expect(tokens[2]).toMatch(/^token-create_run-/);
  expect(tokens[3]).toMatch(/^token-ask_question-/);
  expect(tokens[4]).toMatch(/^token-delete_run-/);
  expect(blobPutTokens).toEqual([undefined, undefined]);
  expect(observedGets.every(({ token }) => token === undefined)).toBe(true);

  const turnstileAudit = await page.evaluate(() => (window as typeof window & {
    __turnstileAudit: { renders: Array<{ id: string; action: string; execution: string; appearance: string; token: string }>; executes: string[]; removes: string[] };
  }).__turnstileAudit);
  expect(turnstileAudit.renders.map(({ action }) => action)).toEqual(["upload_presign", "upload_presign", "create_run", "ask_question", "delete_run"]);
  expect(turnstileAudit.renders.every(({ execution, appearance }) => execution === "execute" && appearance === "interaction-only")).toBe(true);
  expect(new Set(turnstileAudit.renders.map(({ token }) => token)).size).toBe(5);
  expect(turnstileAudit.executes).toHaveLength(5);
  expect(turnstileAudit.removes).toHaveLength(5);
});

test("fails closed with an accessible message when Turnstile cannot load", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__RFP_XRAY_TURNSTILE_TEST_SITE_KEY__", { value: "1x00000000000000000000AA" });
  });
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => route.abort("failed"));
  let runRequests = 0;
  await page.route("**/api/v1/runs", (route) => {
    runRequests += 1;
    return route.abort("blockedbyclient");
  });

  await page.goto("/");
  const facility = page.getByTestId("turnstile-facility");
  await expect(facility).toHaveAttribute("data-availability", "failed");
  await expect(facility).toHaveAttribute("role", "alert");
  await expect(facility.getByText("Security verification unavailable")).toBeVisible();

  await page.getByLabel("CanadaBuys PDF URL").fill("https://canadabuys.canada.ca/tender.pdf");
  await page.getByRole("button", { name: "Analyze pack" }).click();
  await expect(page.getByRole("heading", { name: "The pack could not be analyzed" })).toBeFocused();
  await expect(page.getByText(/Security verification is unavailable/i)).toBeVisible();
  expect(runRequests).toBe(0);
});

test("registers and cleans up progressive WebMCP tools when the browser exposes the API", async ({ page }) => {
  await page.addInitScript(() => {
    const tools: Array<{ tool: Record<string, unknown>; aborted: boolean }> = [];
    Object.defineProperty(window, "__webMcpTools", { value: tools, writable: false });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: Record<string, unknown>, options?: { signal?: AbortSignal }) {
          const entry = { tool, aborted: false };
          tools.push(entry);
          options?.signal?.addEventListener("abort", () => { entry.aborted = true; }, { once: true });
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => {
    const entries = (window as typeof window & { __webMcpTools: Array<{ aborted: boolean }> }).__webMcpTools;
    return entries.filter((entry) => !entry.aborted).length;
  })).toBe(2);

  const registrations = await page.evaluate(() => {
    const entries = (window as typeof window & { __webMcpTools: Array<{ aborted: boolean; tool: { name: string; annotations: Record<string, boolean>; execute: (input: Record<string, unknown>) => string } }> }).__webMcpTools;
    return {
      active: entries.filter((entry) => !entry.aborted).map((entry) => ({ name: entry.tool.name, annotations: entry.tool.annotations })),
      cleanedUp: entries.filter((entry) => entry.aborted).length,
    };
  });
  expect(registrations.active).toEqual([
    { name: "load_edmonton_sample", annotations: { readOnlyHint: false, untrustedContentHint: false } },
    { name: "stage_canadabuys_url", annotations: { readOnlyHint: false, untrustedContentHint: false } },
  ]);
  expect(registrations.cleanedUp).toBeGreaterThanOrEqual(2);

  await page.evaluate(() => {
    const entries = (window as typeof window & { __webMcpTools: Array<{ aborted: boolean; tool: { name: string; execute: (input: Record<string, unknown>) => string } }> }).__webMcpTools;
    entries.find((entry) => !entry.aborted && entry.tool.name === "stage_canadabuys_url")?.tool.execute({ url: "https://canadabuys.canada.ca/staged.pdf" });
  });
  await expect(page.getByLabel("CanadaBuys PDF URL")).toHaveValue("https://canadabuys.canada.ca/staged.pdf");
});
