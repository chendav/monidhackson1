import { createHash } from "node:crypto";

export const MONID_INSPECT_SEMANTIC_CONTRACT_VERSION = 1;

const EXACT_PROVIDER = "context.dev";
const EXACT_ENDPOINT = "/parse";
const EXACT_METHOD = "POST";
const BASE_PRICE_MICRO_USD = 900;
const OCR_INCREMENT_MICRO_USD = 3_600;

const TOP_LEVEL_SEMANTIC_FIELDS = new Set([
  "endpoint", "input", "method", "price", "provider"
]);
const TOP_LEVEL_IGNORED_FIELDS = new Set([
  "categories", "description", "docUrl", "hints", "metrics", "notes",
  "providerName", "summary", "tags"
]);
const TOP_LEVEL_FIELDS = new Set([
  ...TOP_LEVEL_SEMANTIC_FIELDS,
  ...TOP_LEVEL_IGNORED_FIELDS
]);
const SCHEMA_IGNORED_FIELDS = new Set([
  "~standard", "description", "title", "examples"
]);
const SCHEMA_FIELDS = new Set([
  "$anchor", "$defs", "$dynamicAnchor", "$dynamicRef", "$id", "$ref", "$schema",
  "additionalProperties", "allOf", "anyOf", "const", "contains", "default",
  "dependentRequired", "dependentSchemas", "deprecated", "else", "enum",
  "exclusiveMaximum", "exclusiveMinimum", "format", "if", "items",
  "maxContains", "maximum", "maxItems", "maxLength", "maxProperties",
  "minContains", "minimum", "minItems", "minLength", "minProperties",
  "multipleOf", "not", "oneOf", "pattern", "patternProperties",
  "prefixItems", "properties", "propertyNames", "readOnly", "required",
  "then", "type", "unevaluatedItems", "unevaluatedProperties", "uniqueItems",
  "writeOnly"
]);
const SCHEMA_MAP_FIELDS = new Set([
  "$defs", "dependentSchemas", "patternProperties", "properties"
]);
const SCHEMA_ARRAY_FIELDS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const SCHEMA_UNORDERED_ARRAY_FIELDS = new Set(["enum", "required", "type"]);

function fail(reason) {
  const error = new Error(`MONID_INSPECT_SEMANTIC_CONTRACT_INVALID:${reason}`);
  error.code = "MONID_INSPECT_SEMANTIC_CONTRACT_INVALID";
  throw error;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, reason) {
  if (!isPlainObject(value)) fail(reason);
  return value;
}

function exactKeys(value, allowed, required, reason) {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.has(key)) || required.some((key) => !(key in value))) {
    fail(reason);
  }
}

function canonicalString(value, reason) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512 || value !== value.trim()) {
    fail(reason);
  }
  return value;
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function canonicalJsonValue(value, depth, reason) {
  if (depth > 32) fail(`${reason}_depth`);
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${reason}_number`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000) fail(`${reason}_array`);
    return value.map((item) => canonicalJsonValue(item, depth + 1, reason));
  }
  const record = object(value, `${reason}_object`);
  if (Object.keys(record).length > 1_000) fail(`${reason}_keys`);
  return Object.fromEntries(Object.keys(record).sort().map((key) => [
    key,
    canonicalJsonValue(record[key], depth + 1, reason)
  ]));
}

function sortedUnique(values, reason) {
  const serialized = values.map((value) => stableJson(value)).sort();
  if (new Set(serialized).size !== serialized.length) fail(`${reason}_duplicate`);
  return serialized.map((value) => JSON.parse(value));
}

function canonicalSchema(value, depth = 0) {
  if (depth > 32) fail("request_schema_depth");
  if (typeof value === "boolean") return value;
  const schema = object(value, "request_schema_object");
  const result = {};
  for (const key of Object.keys(schema).sort()) {
    if (SCHEMA_IGNORED_FIELDS.has(key)) continue;
    if (!SCHEMA_FIELDS.has(key)) fail(`unknown_request_schema_keyword:${key}`);
    const item = schema[key];
    if (SCHEMA_MAP_FIELDS.has(key)) {
      const map = object(item, `request_schema_${key}`);
      result[key] = Object.fromEntries(Object.keys(map).sort().map((name) => [
        name,
        canonicalSchema(map[name], depth + 1)
      ]));
    } else if (SCHEMA_ARRAY_FIELDS.has(key)) {
      if (!Array.isArray(item) || item.length < 1 || item.length > 100) {
        fail(`request_schema_${key}`);
      }
      const members = item.map((member) => canonicalSchema(member, depth + 1));
      result[key] = key === "prefixItems" ? members : sortedUnique(members, `request_schema_${key}`);
    } else if (SCHEMA_UNORDERED_ARRAY_FIELDS.has(key) && Array.isArray(item)) {
      if (item.length < 1 || item.length > 1_000) fail(`request_schema_${key}`);
      result[key] = sortedUnique(
        item.map((member) => canonicalJsonValue(member, depth + 1, `request_schema_${key}`)),
        `request_schema_${key}`
      );
    } else if (["additionalProperties", "items", "not", "propertyNames",
      "unevaluatedItems", "unevaluatedProperties", "contains", "if", "then", "else"
    ].includes(key) && (typeof item === "boolean" || isPlainObject(item))) {
      result[key] = canonicalSchema(item, depth + 1);
    } else {
      result[key] = canonicalJsonValue(item, depth + 1, `request_schema_${key}`);
    }
  }
  return result;
}

function amount(value, expectedMicroUsd, reason) {
  const record = object(value, `${reason}_object`);
  exactKeys(record, new Set(["currency", "value"]), ["currency", "value"], `${reason}_keys`);
  if (record.currency !== "USD" || typeof record.value !== "number" ||
    !Number.isFinite(record.value) || record.value < 0) fail(reason);
  const microUsd = record.value * 1_000_000;
  if (!Number.isSafeInteger(microUsd) || microUsd !== expectedMicroUsd) fail(reason);
  return { currency: "USD", micro_usd: microUsd };
}

function pricedCall(value, expectedMicroUsd, reason) {
  const record = object(value, `${reason}_object`);
  exactKeys(record, new Set(["amount", "type"]), ["amount", "type"], `${reason}_keys`);
  if (record.type !== "PER_CALL") fail(`${reason}_type`);
  return { amount: amount(record.amount, expectedMicroUsd, `${reason}_amount`), type: "PER_CALL" };
}

function canonicalPrice(value) {
  const price = object(value, "price_object");
  exactKeys(
    price,
    new Set(["amount", "default", "notes", "tiers", "type"]),
    ["amount", "default", "tiers", "type"],
    "price_keys"
  );
  if (price.type !== "TIERED" || !Array.isArray(price.tiers) || price.tiers.length !== 1) {
    fail("price_structure");
  }
  const tier = object(price.tiers[0], "price_tier_object");
  exactKeys(
    tier,
    new Set(["label", "price", "selector", "when"]),
    ["price", "selector", "when"],
    "price_tier_keys"
  );
  const selector = object(tier.selector, "price_selector_object");
  exactKeys(
    selector,
    new Set(["in", "key", "label"]),
    ["in", "key"],
    "price_selector_keys"
  );
  const selectorIn = canonicalString(selector.in, "price_selector_in");
  const selectorKey = canonicalString(selector.key, "price_selector_key");
  const when = object(tier.when, "price_when_object");
  exactKeys(when, new Set(["ocr"]), ["ocr"], "price_when_keys");
  if (when.ocr !== true) fail("price_when_ocr");
  const base = amount(price.amount, BASE_PRICE_MICRO_USD, "price_amount");
  const defaultPrice = pricedCall(price.default, BASE_PRICE_MICRO_USD, "price_default");
  const ocrPrice = pricedCall(tier.price, OCR_INCREMENT_MICRO_USD, "price_ocr");
  return {
    type: "TIERED",
    base,
    default: defaultPrice,
    tiers: [{
      selector: { in: selectorIn, key: selectorKey },
      when: { ocr: true },
      price: ocrPrice
    }],
    reserved_ocr_max_micro_usd: BASE_PRICE_MICRO_USD + OCR_INCREMENT_MICRO_USD
  };
}

function assertCurrentRequestSchema(schema) {
  const expectedProperties = [
    "extension", "file_url", "includeImages", "includeLinks", "ocr",
    "shortenBase64Images", "useMainContentOnly", "zdr"
  ];
  const properties = object(schema.properties, "request_properties");
  if (stableJson(Object.keys(properties).sort()) !== stableJson(expectedProperties)) {
    fail("request_property_set");
  }
  if (schema.type !== "object" || schema.additionalProperties !== false ||
    stableJson(schema.required) !== stableJson(["file_url"])) {
    fail("request_object_contract");
  }
  const expected = {
    extension: { maxLength: 16, minLength: 1, type: "string" },
    file_url: { format: "uri", type: "string" },
    includeImages: { type: "boolean" },
    includeLinks: { type: "boolean" },
    ocr: { type: "boolean" },
    shortenBase64Images: { type: "boolean" },
    useMainContentOnly: { type: "boolean" }
  };
  for (const [name, contract] of Object.entries(expected)) {
    if (stableJson(properties[name]) !== stableJson(contract)) fail(`request_property_${name}`);
  }
  const zdr = object(properties.zdr, "request_property_zdr");
  if (zdr.type !== "string" || !Array.isArray(zdr.enum) || zdr.enum.length !== 2 ||
    zdr.enum.some((item) => typeof item !== "string" || !item)) {
    fail("request_property_zdr");
  }
}

export function projectMonidInspectSemanticContract(payload) {
  const root = object(payload, "root");
  exactKeys(root, TOP_LEVEL_FIELDS, ["provider", "endpoint", "method", "input", "price"], "root_keys");
  if (root.provider !== EXACT_PROVIDER || root.endpoint !== EXACT_ENDPOINT || root.method !== EXACT_METHOD) {
    fail("identity");
  }
  const input = object(root.input, "input_object");
  exactKeys(input, new Set(["body", "bodyType"]), ["body", "bodyType"], "input_keys");
  const bodyType = canonicalString(input.bodyType, "input_body_type");
  const bodySchema = canonicalSchema(input.body);
  assertCurrentRequestSchema(bodySchema);
  return {
    version: MONID_INSPECT_SEMANTIC_CONTRACT_VERSION,
    identity: { provider: EXACT_PROVIDER, endpoint: EXACT_ENDPOINT, method: EXACT_METHOD },
    request: { body_type: bodyType, body_schema: bodySchema },
    pricing: canonicalPrice(root.price)
  };
}

export function monidInspectSemanticContractSha256(payload) {
  const projection = projectMonidInspectSemanticContract(payload);
  return createHash("sha256").update(stableJson(projection)).digest("hex");
}
