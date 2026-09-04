import { describe, expect, it } from "vitest";
import {
  monidInspectSemanticContractSha256,
  projectMonidInspectSemanticContract
} from "@/lib/providers/monid-inspect-contract.mjs";

function inspectPayload() {
  return {
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
          zdr: { type: "string", enum: ["required", "disabled"], description: "ZDR" }
        }
      }
    },
    price: {
      type: "TIERED",
      amount: { value: 0.0009, currency: "USD" },
      default: { amount: { value: 0.0009, currency: "USD" }, type: "PER_CALL" },
      tiers: [{
        label: "OCR", selector: { in: "body", key: "ocr", label: "Use OCR" },
        when: { ocr: true },
        price: { amount: { value: 0.0036, currency: "USD" }, type: "PER_CALL" }
      }],
      notes: ["Presentation only"]
    },
    metrics: { status: "healthy", runTimeMs: { p50: 100, p95: 200 } },
    categories: ["documents"],
    description: "Parse a document",
    docUrl: "https://docs.example/parse",
    hints: { run: "Try this endpoint" },
    notes: ["Catalog note"],
    providerName: "Context",
    summary: "Document parser",
    tags: ["parse"]
  };
}

function semanticMutation(mutator: (payload: ReturnType<typeof inspectPayload>) => void) {
  const baseline = inspectPayload();
  const changed = structuredClone(baseline);
  mutator(changed);
  const expected = monidInspectSemanticContractSha256(baseline);
  try {
    expect(monidInspectSemanticContractSha256(changed)).not.toBe(expected);
  } catch (error) {
    expect(error).toMatchObject({ code: "MONID_INSPECT_SEMANTIC_CONTRACT_INVALID" });
  }
}

describe("Monid inspect semantic contract", () => {
  it("projects only the exact parse identity, recursive request validation, and tiered USD pricing", () => {
    expect(projectMonidInspectSemanticContract(inspectPayload())).toMatchObject({
      version: 1,
      identity: { provider: "context.dev", endpoint: "/parse", method: "POST" },
      request: {
        body_type: "json",
        body_schema: {
          type: "object",
          additionalProperties: false,
          required: ["file_url"]
        }
      },
      pricing: {
        type: "TIERED",
        base: { currency: "USD", micro_usd: 900 },
        default: { amount: { currency: "USD", micro_usd: 900 }, type: "PER_CALL" },
        tiers: [{
          selector: { in: "body", key: "ocr" },
          when: { ocr: true },
          price: { amount: { currency: "USD", micro_usd: 3_600 }, type: "PER_CALL" }
        }],
        reserved_ocr_max_micro_usd: 4_500
      }
    });
  });

  it("ignores only reviewed telemetry, catalog presentation, and schema annotations", () => {
    const baseline = inspectPayload();
    const changed = structuredClone(baseline);
    changed.metrics = { status: "degraded", runTimeMs: { p50: 9_999, p95: 20_000 } };
    changed.categories = ["different"];
    changed.description = "Changed description";
    changed.docUrl = "https://elsewhere.example/docs";
    changed.hints = { run: "Changed hint" };
    changed.notes = ["Changed note"];
    changed.providerName = "Changed display name";
    changed.summary = "Changed summary";
    changed.tags = ["changed"];
    changed.input.body["~standard"] = { vendor: "changed", version: 99, jsonSchema: {} };
    changed.input.body.properties.file_url.description = "Changed field description";
    changed.price.notes = ["Changed price note"];
    changed.price.tiers[0]!.label = "Changed tier label";
    changed.price.tiers[0]!.selector.label = "Changed selector label";
    changed.input.body.properties.zdr.enum.reverse();
    expect(monidInspectSemanticContractSha256(changed))
      .toBe(monidInspectSemanticContractSha256(baseline));
  });

  it("fails closed or changes the fingerprint for every material identity and request mutation", () => {
    const mutations: Array<(payload: ReturnType<typeof inspectPayload>) => void> = [
      (value) => { value.provider = "other"; },
      (value) => { value.endpoint = "/other"; },
      (value) => { value.method = "GET"; },
      (value) => { value.input.bodyType = "form"; },
      (value) => { value.input.body.$schema = "https://json-schema.org/draft-07/schema"; },
      (value) => { value.input.body.required = []; },
      (value) => { value.input.body.additionalProperties = true; },
      (value) => { delete (value.input.body.properties as Partial<typeof value.input.body.properties>).ocr; },
      (value) => { value.input.body.properties.file_url.type = "number"; },
      (value) => { value.input.body.properties.file_url.format = "hostname"; },
      (value) => { value.input.body.properties.extension.minLength = 2; },
      (value) => { value.input.body.properties.extension.maxLength = 15; },
      (value) => { value.input.body.properties.zdr.enum = ["different", "required"]; },
      (value) => {
        (value.input.body.properties.ocr as Record<string, unknown>).unknownValidation = true;
      },
      (value) => { (value as Record<string, unknown>).newCatalogField = true; }
    ];
    for (const mutation of mutations) semanticMutation(mutation);
  });

  it("fails closed or changes the fingerprint for every material price mutation", () => {
    const mutations: Array<(payload: ReturnType<typeof inspectPayload>) => void> = [
      (value) => { value.price.type = "FLAT"; },
      (value) => { value.price.amount.value = 0.001; },
      (value) => { value.price.amount.currency = "CAD"; },
      (value) => { value.price.default.amount.value = 0.001; },
      (value) => { value.price.default.type = "PER_TOKEN"; },
      (value) => { value.price.tiers[0]!.price.amount.value = 0.004; },
      (value) => { value.price.tiers[0]!.price.amount.currency = "CAD"; },
      (value) => { value.price.tiers[0]!.price.type = "PER_TOKEN"; },
      (value) => { value.price.tiers[0]!.selector.in = "query"; },
      (value) => { value.price.tiers[0]!.selector.key = "images"; },
      (value) => { value.price.tiers[0]!.when.ocr = false; },
      (value) => { value.price.tiers.push(structuredClone(value.price.tiers[0]!)); },
      (value) => { (value.price as Record<string, unknown>).unknownSemanticPrice = true; }
    ];
    for (const mutation of mutations) semanticMutation(mutation);
  });
});
