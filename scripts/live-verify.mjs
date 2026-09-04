#!/usr/bin/env node

/**
 * Paid release verification for RFP X-Ray.
 *
 * Safety contract:
 * - provider mutations are impossible unless RFP_XRAY_ALLOW_PAID_LIVE=true;
 * - the API key is read only from the process environment and is never logged or persisted;
 * - SHA-fixed PDFs are parsed per physical page only in memory; source text and API
 *   payloads containing document text are never logged or persisted;
 * - the only files written are sanitized JSON metrics under .data/release-evidence;
 * - every obtained run id is sent through the deletion endpoint in a finally block.
 */

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "docs",
  "specs",
  "MH-001-rfp-xray",
  "official-source-manifest.json"
);
const EVIDENCE_DIRECTORY = path.join(REPOSITORY_ROOT, ".data", "release-evidence");
const PRODUCTION_RELEASE_ORIGIN = "https://rfp-xray.vercel.app";
const EXPECTED_PROVIDER_RETENTION = "context_dev_zdr_unavailable_artifact_expiry_observed_7d";
const TERMINAL_STATUSES = new Set(["ready", "partial", "failed", "cleanup_pending", "expired"]);
const RUN_STATUSES = new Set([
  "queued", "validating", "staging", "page_indexing", "parsing", "purging_source",
  "extracting", "reconciling", "verifying", "ready", "partial", "failed",
  "cleanup_pending", "expired"
]);
const EXPECTED_API_PATHS = [
  "/api/v1/uploads/presign",
  "/api/v1/runs",
  "/api/v1/runs/{run_id}",
  "/api/v1/runs/{run_id}/analysis",
  "/api/v1/runs/{run_id}/questions",
  "/api/v1/samples/edmonton",
  "/api/openapi.json",
  "/api/health"
];
const EXPECTED_DOCUMENT_IDS = new Set([
  "edmonton-100022184-a",
  "cer-84084-26-0009-a-base",
  "cer-84084-26-0009-a-amendment-001",
  "cer-84084-26-0009-a-amendment-002",
  "cer-84084-26-0009-a-amendment-003"
]);
const COST_PROVIDERS = Object.freeze([
  "monid", "openai", "railway_s3", "vercel_blob", "vercel", "neon"
]);
const COST_PROVIDER_SET = new Set(COST_PROVIDERS);
const REQUIRED_LIVE_INFRASTRUCTURE_COST_OPERATIONS = Object.freeze({
  vercel: Object.freeze([
    "fluid_compute_conservative_usage_allocation",
    "workflow_events_conservative_usage_allocation",
    "workflow_data_written_conservative_usage_allocation",
    "workflow_data_retained_conservative_usage_allocation",
    "workflow_queue_conservative_usage_allocation"
  ]),
  neon: Object.freeze(["serverless_postgres_conservative_usage_allocation"]),
  railway_s3: Object.freeze(["temporary_bucket_conservative_usage_allocation"])
});
const FIXTURE_FILENAMES = Object.freeze({
  "edmonton-100022184-a": "edmonton.pdf",
  "cer-84084-26-0009-a-base": "cer-main.pdf",
  "cer-84084-26-0009-a-amendment-001": "cer-amendment-001.pdf",
  "cer-84084-26-0009-a-amendment-002": "cer-amendment-002.pdf",
  "cer-84084-26-0009-a-amendment-003": "cer-amendment-003.pdf"
});
const SENSITIVE_KEY = /(?:authorization|api[_-]?key|secret|cookie|signed[_-]?url|upload[_-]?url|evidence[_-]?quote|markdown|document[_-]?text|raw[_-]?(?:body|payload)|(?:^|[_-])pdf(?:$|[_-])|question|answer)/i;
const SENSITIVE_STRING = /(?:\r|\n|```|^\s*#{1,6}\s|\*\*[^*]+\*\*|%PDF-|\bJVBERi[A-Za-z0-9+/=]{4,}|!?\[[^\]]*\]\([^)]*\)|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}|(?:https?|postgres(?:ql)?):\/\/|(?:^|[?&])(?:token|sig|signature|sv|se|sp|sr|x-amz-[^=]*)=|blob\.vercel-storage\.com|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;

export class LiveVerificationError extends Error {
  constructor(code, stage = "unknown") {
    super(code);
    this.name = "LiveVerificationError";
    this.code = code;
    this.stage = stage;
  }
}

class HttpVerificationError extends LiveVerificationError {
  constructor(code, stage, httpStatus, remoteErrorCode = null, possibleRunIds = []) {
    super(code, stage);
    this.httpStatus = httpStatus;
    this.remoteErrorCode = remoteErrorCode;
    this.possibleRunIds = possibleRunIds;
  }
}

function fail(code, stage) {
  throw new LiveVerificationError(code, stage);
}

function asRecord(value, code, stage) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, stage);
  return value;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value) {
  return sha256Text(stableJson(value));
}

function parseUsdToMicro(value, code, { minimum = 1, maximum = 20_000_000 } = {}) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value)) fail(code, "configuration");
  const [dollars, fraction = ""] = value.split(".");
  const micro = Number(dollars) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  if (!Number.isSafeInteger(micro) || micro < minimum || micro > maximum) fail(code, "configuration");
  return micro;
}

function parsePositiveInteger(value, fallback, code, maximum) {
  const candidate = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate <= 0 || candidate > maximum) fail(code, "configuration");
  return candidate;
}

function isPublicAddress(address) {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (kind === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) return isPublicAddress(normalized.slice(7));
    return !(normalized === "::" || normalized === "::1" ||
      normalized.startsWith("fc") || normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:"));
  }
  return false;
}

export async function assertPublicProductionOrigin(
  baseUrl,
  resolver = async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address)
) {
  const target = new URL(baseUrl);
  if (target.origin !== PRODUCTION_RELEASE_ORIGIN || target.href !== `${PRODUCTION_RELEASE_ORIGIN}/`) {
    fail("BASE_URL_NOT_APPROVED_PRODUCTION_ORIGIN", "credential_egress_gate");
  }
  let addresses;
  try {
    addresses = isIP(target.hostname) ? [target.hostname] : await resolver(target.hostname);
  } catch {
    fail("BASE_URL_DNS_LOOKUP_FAILED", "credential_egress_gate");
  }
  if (!Array.isArray(addresses) || addresses.length === 0 ||
    addresses.some((address) => typeof address !== "string" || !isPublicAddress(address))) {
    fail("BASE_URL_DNS_NOT_PUBLIC", "credential_egress_gate");
  }
  return true;
}

function decimalCurrencyMajorToMicro(value, code, stage) {
  const rendered = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof rendered !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(rendered)) fail(code, stage);
  const [whole, fraction = ""] = rendered.split(".");
  const micro = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  if (!Number.isSafeInteger(micro) || micro < 0) fail(code, stage);
  return micro;
}

export async function readMonidWalletBalance(
  apiKey,
  resolver = async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address),
  fetcher = fetch
) {
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    fail("MONID_API_KEY_REQUIRED_FOR_WALLET", "wallet_reconciliation");
  }
  const walletUrl = new URL("https://api.monid.ai/v1/wallet/balance");
  let addresses;
  try {
    addresses = await resolver(walletUrl.hostname);
  } catch {
    fail("MONID_WALLET_DNS_LOOKUP_FAILED", "wallet_reconciliation");
  }
  if (!Array.isArray(addresses) || addresses.length === 0 ||
    addresses.some((address) => typeof address !== "string" || !isPublicAddress(address))) {
    fail("MONID_WALLET_DNS_NOT_PUBLIC", "wallet_reconciliation");
  }
  let response;
  try {
    response = await fetcher(walletUrl, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(20_000)
    });
  } catch {
    fail("MONID_WALLET_REQUEST_FAILED", "wallet_reconciliation");
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    fail("MONID_WALLET_REDIRECT_REJECTED", "wallet_reconciliation");
  }
  if (!response.ok) {
    await response.body?.cancel();
    fail("MONID_WALLET_HTTP_REJECTED", "wallet_reconciliation");
  }
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    fail("MONID_WALLET_RESPONSE_INVALID", "wallet_reconciliation");
  }
  const balance = asRecord(payload?.balance, "MONID_WALLET_RESPONSE_INVALID", "wallet_reconciliation");
  if (balance.currency !== "USD") fail("MONID_WALLET_CURRENCY_UNSUPPORTED", "wallet_reconciliation");
  return decimalCurrencyMajorToMicro(
    balance.value,
    "MONID_WALLET_RESPONSE_INVALID",
    "wallet_reconciliation"
  );
}

export function parseRuntimeOptions(environment = process.env, now = new Date()) {
  const rawBaseUrl = environment.RFP_XRAY_BASE_URL;
  if (!rawBaseUrl) fail("BASE_URL_REQUIRED", "configuration");
  let parsedBase;
  try {
    parsedBase = new URL(rawBaseUrl);
  } catch {
    fail("BASE_URL_INVALID", "configuration");
  }
  if (
    parsedBase.protocol !== "https:" || parsedBase.username || parsedBase.password ||
    parsedBase.port || parsedBase.search || parsedBase.hash ||
    !["", "/"].includes(parsedBase.pathname) || parsedBase.origin !== PRODUCTION_RELEASE_ORIGIN
  ) {
    fail("BASE_URL_NOT_APPROVED_PRODUCTION_ORIGIN", "configuration");
  }

  const fixtureDirectory = environment.RFP_XRAY_FIXTURE_DIR;
  if (!fixtureDirectory) fail("FIXTURE_DIRECTORY_REQUIRED", "configuration");
  const resolvedFixtureDirectory = path.resolve(fixtureDirectory);
  const campaignId = environment.RFP_XRAY_LIVE_CAMPAIGN_ID ??
    `release-${now.toISOString().slice(0, 10)}`;
  if (!/^[A-Za-z0-9._-]{1,48}$/.test(campaignId)) fail("CAMPAIGN_ID_INVALID", "configuration");

  const totalBudgetMicroUsd = parseUsdToMicro(
    environment.RFP_XRAY_LIVE_BUDGET_USD ?? "20",
    "TOTAL_BUDGET_INVALID",
    { maximum: 20_000_000 }
  );
  const declaredPerRunCapMicroUsd = parseUsdToMicro(
    environment.RFP_XRAY_LIVE_PER_RUN_CAP_USD ?? "2",
    "PER_RUN_CAP_INVALID",
    { maximum: 3_000_000 }
  );
  if (declaredPerRunCapMicroUsd > totalBudgetMicroUsd) {
    fail("PER_RUN_CAP_EXCEEDS_TOTAL_BUDGET", "configuration");
  }

  return {
    baseUrl: parsedBase.origin,
    fixtureDirectory: resolvedFixtureDirectory,
    campaignId,
    allowPaidLive: environment.RFP_XRAY_ALLOW_PAID_LIVE === "true",
    apiKey: environment.RFP_XRAY_API_KEY || null,
    monidApiKey: environment.MONID_API_KEY || null,
    totalBudgetMicroUsd,
    declaredPerRunCapMicroUsd,
    pollIntervalMs: parsePositiveInteger(
      environment.RFP_XRAY_LIVE_POLL_INTERVAL_MS,
      3_000,
      "POLL_INTERVAL_INVALID",
      30_000
    ),
    runTimeoutMs: parsePositiveInteger(
      environment.RFP_XRAY_LIVE_RUN_TIMEOUT_MS,
      15 * 60_000,
      "RUN_TIMEOUT_INVALID",
      30 * 60_000
    ),
    cleanupTimeoutMs: parsePositiveInteger(
      environment.RFP_XRAY_LIVE_CLEANUP_TIMEOUT_MS,
      2 * 60_000,
      "CLEANUP_TIMEOUT_INVALID",
      10 * 60_000
    )
  };
}

function validateOfficialManifest(value) {
  const manifest = asRecord(value, "MANIFEST_INVALID", "fixture_verification");
  if (manifest.hash_algorithm !== "sha256" || typeof manifest.verified_at !== "string") {
    fail("MANIFEST_INVALID", "fixture_verification");
  }
  if (!Array.isArray(manifest.documents) || manifest.documents.length !== EXPECTED_DOCUMENT_IDS.size) {
    fail("MANIFEST_DOCUMENT_SET_INVALID", "fixture_verification");
  }
  const seenIds = new Set();
  const seenHashes = new Set();
  const seenUrls = new Set();
  const documents = manifest.documents.map((raw) => {
    const document = asRecord(raw, "MANIFEST_DOCUMENT_INVALID", "fixture_verification");
    if (
      typeof document.id !== "string" || !EXPECTED_DOCUMENT_IDS.has(document.id) || seenIds.has(document.id) ||
      !["base", "amendment"].includes(document.role) ||
      typeof document.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(document.sha256) || seenHashes.has(document.sha256) ||
      !Number.isInteger(document.bytes) || document.bytes <= 0 ||
      !Number.isInteger(document.physical_pages) || document.physical_pages <= 0 ||
      typeof document.url !== "string"
    ) {
      fail("MANIFEST_DOCUMENT_INVALID", "fixture_verification");
    }
    let sourceUrl;
    try {
      sourceUrl = new URL(document.url);
    } catch {
      fail("MANIFEST_SOURCE_URL_INVALID", "fixture_verification");
    }
    if (
      sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "canadabuys.canada.ca" ||
      sourceUrl.username || sourceUrl.password || seenUrls.has(sourceUrl.href)
    ) {
      fail("MANIFEST_SOURCE_URL_INVALID", "fixture_verification");
    }
    seenIds.add(document.id);
    seenHashes.add(document.sha256);
    seenUrls.add(sourceUrl.href);
    return {
      id: document.id,
      role: document.role,
      url: sourceUrl.href,
      sha256: document.sha256,
      bytes: document.bytes,
      physical_pages: document.physical_pages
    };
  });
  if ([...EXPECTED_DOCUMENT_IDS].some((id) => !seenIds.has(id))) {
    fail("MANIFEST_DOCUMENT_SET_INVALID", "fixture_verification");
  }
  return { verified_at: manifest.verified_at, documents };
}

async function hashFile(filePath) {
  const digest = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}

export function normalizeEvidenceText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u00ad\u200b-\u200d\ufeff]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-CA");
}

export async function extractPhysicalPageTexts(filePath) {
  let document;
  let loadingTask;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = new Uint8Array(await readFile(filePath));
    loadingTask = pdfjs.getDocument({
      data: bytes,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true
    });
    document = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const fragments = [];
      for (const item of content.items) {
        if (!item || typeof item !== "object" || !("str" in item)) continue;
        fragments.push(String(item.str));
        if ("hasEOL" in item && item.hasEOL) fragments.push("\n");
        else fragments.push(" ");
      }
      pages.push(normalizeEvidenceText(fragments.join("")));
      page.cleanup();
    }
    return pages;
  } catch {
    fail("FIXTURE_PDF_PARSE_FAILED", "fixture_verification");
  } finally {
    try {
      await document?.cleanup();
      await loadingTask?.destroy();
    } catch {
      // Parsing output already lives in normalized strings; cleanup failure
      // must not surface a provider URL or document content.
    }
  }
}

export async function verifyOfficialFixtures({
  manifestPath = MANIFEST_PATH,
  fixtureDirectory,
  pageTextExtractor = extractPhysicalPageTexts
}) {
  let manifest;
  try {
    manifest = validateOfficialManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  } catch (error) {
    if (error instanceof LiveVerificationError) throw error;
    fail("MANIFEST_READ_FAILED", "fixture_verification");
  }

  let totalBytes = 0;
  let totalPages = 0;
  const sourcePagesBySha = new Map();
  for (const document of manifest.documents) {
    const filename = FIXTURE_FILENAMES[document.id];
    if (!filename) fail("FIXTURE_MAPPING_MISSING", "fixture_verification");
    const fixturePath = path.join(fixtureDirectory, filename);
    let metadata;
    try {
      metadata = await stat(fixturePath);
    } catch {
      fail("FIXTURE_MISSING", "fixture_verification");
    }
    if (!metadata.isFile() || metadata.size !== document.bytes) {
      fail("FIXTURE_BYTE_LENGTH_MISMATCH", "fixture_verification");
    }
    let actualHash;
    try {
      actualHash = await hashFile(fixturePath);
    } catch {
      fail("FIXTURE_HASH_READ_FAILED", "fixture_verification");
    }
    if (actualHash !== document.sha256) fail("FIXTURE_SHA256_MISMATCH", "fixture_verification");
    const pageTexts = await pageTextExtractor(fixturePath);
    if (!Array.isArray(pageTexts) || pageTexts.length !== document.physical_pages ||
      pageTexts.some((pageText) => typeof pageText !== "string")) {
      fail("FIXTURE_PHYSICAL_PAGE_COUNT_MISMATCH", "fixture_verification");
    }
    sourcePagesBySha.set(document.sha256, pageTexts.map(normalizeEvidenceText));
    totalBytes += metadata.size;
    totalPages += pageTexts.length;
  }
  return {
    manifest,
    sourcePagesBySha,
    metrics: {
      manifest_sha256: sha256Json(manifest),
      manifest_verified_at: manifest.verified_at,
      document_count: manifest.documents.length,
      bytes_verified: totalBytes,
      byte_lengths_verified: true,
      sha256_verified: true,
      physical_pages_verified: totalPages
    }
  };
}

function authHeaders(apiKey, extra = {}) {
  return { ...extra, authorization: `Bearer ${apiKey}` };
}

function remoteErrorCode(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const error = payload.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  return typeof error.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code)
    ? error.code
    : null;
}

function possibleRunId(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return typeof payload.run_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.run_id)
    ? payload.run_id
    : null;
}

async function requestJson(url, options = {}) {
  const {
    stage = "http",
    acceptedStatuses = [200],
    timeoutMs = 30_000,
    retries = 0,
    signal,
    ...requestOptions
  } = options;
  const obtainedRunIds = new Set();
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);
      response = await fetch(url, {
        redirect: "error",
        cache: "no-store",
        ...requestOptions,
        signal: requestSignal
      });
    } catch {
      if (attempt < retries && !signal?.aborted) continue;
      throw new HttpVerificationError("HTTP_REQUEST_FAILED", stage, null, null, [...obtainedRunIds]);
    }
    let payload = null;
    if (response.status !== 204) {
      try {
        payload = JSON.parse(await response.text());
      } catch {
        if (attempt < retries && response.status >= 500) continue;
        throw new HttpVerificationError(
          "HTTP_JSON_INVALID",
          stage,
          response.status,
          null,
          [...obtainedRunIds]
        );
      }
    }
    const responseRunId = possibleRunId(payload);
    if (responseRunId) obtainedRunIds.add(responseRunId);
    if (!acceptedStatuses.includes(response.status)) {
      if (attempt < retries && response.status >= 500) continue;
      throw new HttpVerificationError(
        "HTTP_STATUS_REJECTED",
        stage,
        response.status,
        remoteErrorCode(payload),
        [...obtainedRunIds]
      );
    }
    return { status: response.status, payload, obtainedRunIds: [...obtainedRunIds] };
  }
  fail("HTTP_RETRY_STATE_INVALID", stage);
}

function validateCitation(citation, expectedHashes, sourcePagesBySha) {
  if (!(
    citation && typeof citation === "object" && !Array.isArray(citation) &&
    typeof citation.document_sha256 === "string" && expectedHashes.has(citation.document_sha256) &&
    Number.isInteger(citation.pdf_page_1based) && citation.pdf_page_1based > 0 &&
    typeof citation.evidence_quote === "string" && citation.evidence_quote.trim().length > 0 &&
    citation.verified === true && ["exact", "normalized"].includes(citation.verification_method)
  )) return false;

  const pages = sourcePagesBySha?.get(citation.document_sha256);
  const pageText = Array.isArray(pages) ? pages[citation.pdf_page_1based - 1] : null;
  const normalizedQuote = normalizeEvidenceText(citation.evidence_quote);
  return typeof pageText === "string" && normalizedQuote.length > 0 &&
    normalizeEvidenceText(pageText).includes(normalizedQuote);
}

function collectCitationObjects(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectCitationObjects(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (
    typeof value.document_sha256 === "string" &&
    Object.hasOwn(value, "pdf_page_1based") &&
    Object.hasOwn(value, "evidence_quote")
  ) {
    output.push(value);
    return output;
  }
  for (const child of Object.values(value)) collectCitationObjects(child, output);
  return output;
}

export function verifySourceCitations(analysis, expectedDocuments, sourcePagesBySha) {
  const expectedHashes = new Set(expectedDocuments.map((document) => document.sha256));
  const surfaces = {
    summary: analysis.summary,
    claims: analysis.claims,
    requirements: analysis.requirements,
    evaluation: analysis.evaluation,
    risks: analysis.risks,
    conflicts: analysis.conflicts,
    clarification_questions: analysis.clarification_questions,
    blocking_unknowns: analysis.blocking_unknowns
  };
  let matched = 0;
  const bySurface = {};
  for (const [surface, value] of Object.entries(surfaces)) {
    const citations = collectCitationObjects(value);
    if (citations.some((citation) => !validateCitation(citation, expectedHashes, sourcePagesBySha))) {
      fail("INDEPENDENT_SOURCE_QUOTE_MISMATCH", "citation_source_validation");
    }
    bySurface[surface] = citations.length;
    matched += citations.length;
  }
  if (matched === 0) fail("INDEPENDENT_SOURCE_CITATIONS_MISSING", "citation_source_validation");
  return { matched, bySurface };
}

function visibleCitationGroups(analysis) {
  const groups = [];
  for (const item of Array.isArray(analysis.claims) ? analysis.claims : []) {
    if (item.claim_type !== "unknown") groups.push(item.citations);
  }
  for (const item of Array.isArray(analysis.requirements) ? analysis.requirements : []) groups.push(item.citations);
  if (analysis.evaluation && typeof analysis.evaluation === "object") groups.push(analysis.evaluation.citations);
  for (const item of Array.isArray(analysis.risks) ? analysis.risks : []) groups.push(item.citations);
  for (const item of Array.isArray(analysis.conflicts) ? analysis.conflicts : []) groups.push(item.citations);
  return groups;
}

function monidSourceCostToMicro(provenance) {
  if (provenance.source_currency !== "USD") {
    fail("MONID_COST_CURRENCY_UNRESOLVED", "analysis_validation");
  }
  if (provenance.value_unit === "currency_major") {
    return decimalCurrencyMajorToMicro(
      provenance.source_value,
      "MONID_COST_VALUE_INVALID",
      "analysis_validation"
    );
  }
  if (provenance.value_unit === "micro_dollar" &&
    Number.isInteger(provenance.source_value) && provenance.source_value >= 0) {
    return provenance.source_value;
  }
  fail("MONID_COST_UNIT_UNRESOLVED", "analysis_validation");
}

export function validateMonidCostAccounting(costs, expectedDocumentCount) {
  const monidEvents = [];
  for (const raw of costs.events) {
    const event = asRecord(raw, "ANALYSIS_COST_EVENT_INVALID", "analysis_validation");
    if (event.status !== "succeeded") {
      fail(
        event.status === "failed"
          ? "FAILED_PROVIDER_ATTEMPT_PRESENT"
          : "INCOMPLETE_PROVIDER_ATTEMPT_PRESENT",
        "analysis_validation"
      );
    }
    if (event.actual_micro_usd === null && event.estimated_micro_usd === null) {
      fail("UNRESOLVED_PROVIDER_COST", "analysis_validation");
    }
    if (event.provider !== "monid") continue;
    monidEvents.push(event);
    if (!isNonNegativeInteger(event.actual_micro_usd) || event.estimated_micro_usd !== null) {
      fail("MONID_ACTUAL_COST_REQUIRED", "analysis_validation");
    }
    const provenance = asRecord(
      event.cost_provenance,
      "MONID_COST_PROVENANCE_REQUIRED",
      "analysis_validation"
    );
    if (
      provenance.kind !== "credentialed_inspect" ||
      typeof provenance.inspect_schema_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(provenance.inspect_schema_sha256) ||
      typeof provenance.value_path !== "string" || provenance.value_path.length === 0 ||
      typeof provenance.currency_path !== "string" || provenance.currency_path.length === 0 ||
      !["currency_major", "micro_dollar"].includes(provenance.value_unit) ||
      !(typeof provenance.source_value === "number" || typeof provenance.source_value === "string")
    ) {
      fail("MONID_COST_PROVENANCE_INVALID", "analysis_validation");
    }
    if (monidSourceCostToMicro(provenance) !== event.actual_micro_usd) {
      fail("MONID_COST_CONVERSION_MISMATCH", "analysis_validation");
    }
  }
  if (monidEvents.length !== expectedDocumentCount || costs.includes_failed_attempts !== false) {
    fail("MONID_COST_EVENT_COUNT_INVALID", "analysis_validation");
  }
  return monidEvents.reduce((sum, event) => sum + event.actual_micro_usd, 0);
}

function allFacts(analysis) {
  return [
    ...(Array.isArray(analysis.claims) ? analysis.claims : []),
    ...(Array.isArray(analysis.requirements) ? analysis.requirements : [])
  ];
}

function textOfFact(fact) {
  return typeof fact.claim_text === "string" ? fact.claim_text :
    typeof fact.text === "string" ? fact.text : "";
}

function factSourceContains(fact, pattern) {
  if (pattern.test(textOfFact(fact))) return true;
  return (fact.citations ?? []).some((citation) =>
    (typeof citation.section === "string" && pattern.test(citation.section)) ||
    (typeof citation.evidence_quote === "string" && pattern.test(citation.evidence_quote))
  );
}

function factHasCitation(fact, predicate) {
  return Array.isArray(fact.citations) && fact.citations.some(predicate);
}

export function validateAnalysisEnvelope(
  analysis,
  expectedDocuments,
  sourcePagesBySha,
  { requireLiveCosts = true } = {}
) {
  const value = asRecord(analysis, "ANALYSIS_INVALID", "analysis_validation");
  if (value.schema_version !== "1.0" || value.source_scope !== "document_only") {
    fail("ANALYSIS_CONTRACT_INVALID", "analysis_validation");
  }
  if (!Array.isArray(value.document_manifest) || value.document_manifest.length !== expectedDocuments.length) {
    fail("ANALYSIS_DOCUMENT_MANIFEST_INVALID", "analysis_validation");
  }
  const expectedByHash = new Map(expectedDocuments.map((document) => [document.sha256, document]));
  const seen = new Set();
  for (const raw of value.document_manifest) {
    const document = asRecord(raw, "ANALYSIS_DOCUMENT_MANIFEST_INVALID", "analysis_validation");
    const expected = expectedByHash.get(document.sha256);
    if (
      !expected || seen.has(document.sha256) || document.role !== expected.role ||
      document.pages !== expected.physical_pages || document.cleanup_status !== "deleted"
    ) {
      fail("ANALYSIS_DOCUMENT_MANIFEST_INVALID", "analysis_validation");
    }
    seen.add(document.sha256);
  }
  const quality = asRecord(value.quality, "ANALYSIS_QUALITY_INVALID", "analysis_validation");
  if (
    quality.search_events !== 0 || quality.follow_embedded_link_events !== 0 ||
    !isNonNegativeInteger(quality.critical_claims) ||
    quality.critical_claims !== quality.critical_claims_cited ||
    !isNonNegativeInteger(quality.citations_verified)
  ) {
    fail("ANALYSIS_QUALITY_GATE_FAILED", "analysis_validation");
  }
  const expectedHashes = new Set(expectedDocuments.map((document) => document.sha256));
  const citationGroups = visibleCitationGroups(value);
  if (citationGroups.length === 0 || citationGroups.some((group) =>
    !Array.isArray(group) || group.length === 0 ||
    group.some((citation) => !validateCitation(citation, expectedHashes, sourcePagesBySha))
  )) {
    fail("VISIBLE_CITATION_GATE_FAILED", "analysis_validation");
  }
  verifySourceCitations(value, expectedDocuments, sourcePagesBySha);
  const costs = asRecord(value.costs, "ANALYSIS_COST_INVALID", "analysis_validation");
  const costEvents = Array.isArray(costs.events) ? costs.events : [];
  const unpricedProviders = Array.isArray(costs.unpriced_providers) ? costs.unpriced_providers : [];
  const notApplicableProviders = Array.isArray(costs.not_applicable_providers)
    ? costs.not_applicable_providers
    : [];
  const validProviderList = (providers) => providers.every((provider) =>
    typeof provider === "string" && COST_PROVIDER_SET.has(provider)
  ) && new Set(providers).size === providers.length;
  const pricedProviders = new Set();
  const pricedOperationsByProvider = new Map();
  let computedActualMicroUsd = 0;
  let computedEstimatedMicroUsd = 0;
  let costEventsValid = true;
  for (const rawEvent of costEvents) {
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
      costEventsValid = false;
      continue;
    }
    const event = rawEvent;
    const actualValid = event.actual_micro_usd === null || isNonNegativeInteger(event.actual_micro_usd);
    const estimatedValid = event.estimated_micro_usd === null || isNonNegativeInteger(event.estimated_micro_usd);
    if (
      !COST_PROVIDER_SET.has(event.provider) ||
      !["pending", "succeeded", "failed"].includes(event.status) ||
      !actualValid ||
      !estimatedValid
    ) {
      costEventsValid = false;
      continue;
    }
    if (event.actual_micro_usd !== null || event.estimated_micro_usd !== null) {
      pricedProviders.add(event.provider);
      const operations = pricedOperationsByProvider.get(event.provider) ?? new Set();
      operations.add(event.operation);
      pricedOperationsByProvider.set(event.provider, operations);
    }
    computedActualMicroUsd += event.actual_micro_usd ?? 0;
    if (event.actual_micro_usd === null) computedEstimatedMicroUsd += event.estimated_micro_usd ?? 0;
  }
  const unpricedSet = new Set(unpricedProviders);
  const notApplicableSet = new Set(notApplicableProviders);
  const allProvidersAccountedFor = COST_PROVIDERS.every((provider) =>
    pricedProviders.has(provider) || unpricedSet.has(provider) || notApplicableSet.has(provider)
  );
  if (
    costs.currency !== "USD" || !isNonNegativeInteger(costs.actual_micro_usd) ||
    !isNonNegativeInteger(costs.estimated_micro_usd) ||
    !isNonNegativeInteger(costs.known_subtotal_micro_usd) ||
    !isNonNegativeInteger(costs.total_micro_usd) ||
    costs.known_subtotal_micro_usd !== costs.actual_micro_usd + costs.estimated_micro_usd ||
    costs.total_micro_usd !== costs.known_subtotal_micro_usd ||
    costs.actual_micro_usd !== computedActualMicroUsd ||
    costs.estimated_micro_usd !== computedEstimatedMicroUsd ||
    !["complete", "partial"].includes(costs.completeness) ||
    (costs.completeness === "complete") !== (unpricedProviders.length === 0) ||
    !validProviderList(unpricedProviders) || !validProviderList(notApplicableProviders) ||
    notApplicableProviders.length !== 1 || notApplicableProviders[0] !== "vercel_blob" ||
    !costEventsValid || !allProvidersAccountedFor ||
    [...pricedProviders].some((provider) => unpricedSet.has(provider) || notApplicableSet.has(provider)) ||
    unpricedProviders.some((provider) => notApplicableSet.has(provider)) ||
    typeof costs.includes_failed_attempts !== "boolean" || !Array.isArray(costs.events)
  ) {
    fail("ANALYSIS_COST_INVALID", "analysis_validation");
  }
  if (requireLiveCosts) {
    for (const [provider, requiredOperations] of
      Object.entries(REQUIRED_LIVE_INFRASTRUCTURE_COST_OPERATIONS)) {
      const pricedOperations = pricedOperationsByProvider.get(provider) ?? new Set();
      if (requiredOperations.some((operation) => !pricedOperations.has(operation))) {
        fail("INFRASTRUCTURE_COST_DIMENSIONS_MISSING", "analysis_validation");
      }
    }
    validateMonidCostAccounting(costs, expectedDocuments.length);
  }
  return value;
}

function citationPagesForSha(item, sha256) {
  return new Set((Array.isArray(item.citations) ? item.citations : [])
    .filter((citation) => citation.document_sha256 === sha256)
    .map((citation) => citation.pdf_page_1based));
}

function hasFact(analysis, predicate) {
  return allFacts(analysis).some((fact) => predicate(fact, textOfFact(fact)));
}

export function validateEdmontonGolden(analysis, document) {
  if (
    analysis.package_completeness !== "unverified" || analysis.quality.pages_total !== 55 ||
    analysis.evaluation?.mandatory_gate !== true || analysis.evaluation?.rated_threshold !== null ||
    analysis.evaluation?.technical_weight !== null || analysis.evaluation?.financial_weight !== null ||
    !/lowest evaluated price/i.test(analysis.evaluation?.selection_method ?? "") ||
    !Array.isArray(analysis.evaluation?.citations) ||
    !analysis.evaluation.citations.some((citation) =>
      citation.document_sha256 === document.sha256 && citation.pdf_page_1based === 14)
  ) {
    fail("EDMONTON_EVALUATION_GATE_FAILED", "golden_validation");
  }

  const mandatory = (Array.isArray(analysis.requirements) ? analysis.requirements : [])
    .filter((requirement) => requirement.category === "mandatory" && requirement.status === "active");
  const mandatoryCriteria = mandatory.filter((requirement) =>
    (Array.isArray(requirement.citations) ? requirement.citations : []).some((citation) =>
      citation.document_sha256 === document.sha256 && citation.pdf_page_1based === 43 &&
      /^M\d{1,3}$/.test(String(citation.section ?? "").trim().toUpperCase())
    )
  );
  const mandatorySections = new Set(mandatoryCriteria.flatMap((requirement) =>
    requirement.citations
      .filter((citation) => citation.document_sha256 === document.sha256 && citation.pdf_page_1based === 43)
      .map((citation) => String(citation.section ?? "").trim().toUpperCase())
  ));
  if (
    mandatoryCriteria.length !== 4 || ["M1", "M2", "M3", "M4"].some((section) => !mandatorySections.has(section)) ||
    !mandatoryCriteria.some((requirement) =>
      /\bup to\s+(?:three|3)\b/i.test(requirement.text ?? "") &&
      factHasCitation(requirement, (citation) => citation.pdf_page_1based === 43)
    )
  ) {
    fail("EDMONTON_MANDATORY_GATE_FAILED", "golden_validation");
  }

  const securityPages = new Set((Array.isArray(analysis.requirements) ? analysis.requirements : [])
    .filter((requirement) => requirement.category === "security")
    .flatMap((requirement) => requirement.citations ?? [])
    .filter((citation) => citation.document_sha256 === document.sha256)
    .map((citation) => citation.pdf_page_1based));
  if ([15, 16, 17].some((page) => !securityPages.has(page))) {
    fail("EDMONTON_SECURITY_GATE_FAILED", "golden_validation");
  }

  const conflicts = Array.isArray(analysis.conflicts) ? analysis.conflicts : [];
  const annexConflict = conflicts.find((conflict) => {
    const values = new Set((conflict.candidate_values ?? []).map((value) => String(value).toLowerCase()));
    const pages = citationPagesForSha(conflict, document.sha256);
    return conflict.status === "conflicted" && values.has("annex d") && values.has("annex e") &&
      pages.has(17) && pages.has(43);
  });
  if (!annexConflict || conflicts.length !== 1) {
    fail("EDMONTON_ANNEX_CONFLICT_GATE_FAILED", "golden_validation");
  }

  const flattenedText = stableJson({
    summary: analysis.summary,
    claims: analysis.claims,
    requirements: analysis.requirements,
    blocking_unknowns: analysis.blocking_unknowns
  });
  if (/\b(?:contract|bid|pricing|price)\s+(?:total|value|amount)?\s*(?:is|=|:)\s*\$?0(?:\.0+)?\b/i.test(flattenedText)) {
    fail("EDMONTON_BLANK_PRICE_INVENTED", "golden_validation");
  }
  return {
    golden_checks: 7,
    mandatory_active_count: mandatoryCriteria.length,
    source_pages: 55,
    package_completeness_unverified: true
  };
}

function deadlineTextMatches(text, day) {
  if (typeof text !== "string") return false;
  const normalized = text.toLowerCase();
  const hasDate = day === 3
    ? /(?:2026[-/]09[-/]0?3|(?:september|sep\.?)\s+0?3,?\s+2026)/i.test(text)
    : /(?:2026[-/]09[-/]15|(?:september|sep\.?)\s+15,?\s+2026)/i.test(text);
  return hasDate && /(?:14\s*:\s*00|2\s*:\s*00\s*p\.?m\.?)/i.test(text) &&
    (normalized.includes("mdt") || normalized.includes("-06:00"));
}

export function validateCerGolden(analysis, documents) {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const base = byId.get("cer-84084-26-0009-a-base");
  const amendment001 = byId.get("cer-84084-26-0009-a-amendment-001");
  const amendment002 = byId.get("cer-84084-26-0009-a-amendment-002");
  const amendment003 = byId.get("cer-84084-26-0009-a-amendment-003");
  if (!base || !amendment001 || !amendment002 || !amendment003) {
    fail("CER_MANIFEST_GATE_FAILED", "golden_validation");
  }
  if (analysis.quality.pages_total !== 75) fail("CER_PAGE_GATE_FAILED", "golden_validation");

  const manifestAmendments = new Map(analysis.document_manifest.map((document) =>
    [document.sha256, document.amendment_number]
  ));
  if (
    manifestAmendments.get(base.sha256) !== null || manifestAmendments.get(amendment001.sha256) !== "001" ||
    manifestAmendments.get(amendment002.sha256) !== "002" || manifestAmendments.get(amendment003.sha256) !== "003"
  ) {
    fail("CER_VERSION_CHAIN_GATE_FAILED", "golden_validation");
  }

  if (!deadlineTextMatches(analysis.summary?.closing_date, 15)) {
    fail("CER_CURRENT_DEADLINE_GATE_FAILED", "golden_validation");
  }
  const oldDeadlineSuperseded = hasFact(analysis, (fact, text) =>
    fact.status === "superseded" && deadlineTextMatches(text, 3) &&
    factHasCitation(fact, (citation) => citation.document_sha256 === base.sha256 && citation.pdf_page_1based === 1)
  );
  const newDeadlineActive = hasFact(analysis, (fact, text) =>
    fact.status === "active" && deadlineTextMatches(text, 15) &&
    factHasCitation(fact, (citation) =>
      citation.document_sha256 === amendment002.sha256 && [1, 2].includes(citation.pdf_page_1based))
  );
  if (!oldDeadlineSuperseded || !newDeadlineActive) {
    fail("CER_DEADLINE_RECONCILIATION_GATE_FAILED", "golden_validation");
  }

  const basisSuperseded = hasFact(analysis, (fact) =>
    fact.status === "superseded" && factSourceContains(fact, /basis of payment/i) &&
    factHasCitation(fact, (citation) => citation.document_sha256 === base.sha256)
  );
  const basisReplacementActive = hasFact(analysis, (fact) =>
    fact.status === "active" && factSourceContains(fact, /basis of payment/i) &&
    factHasCitation(fact, (citation) =>
      citation.document_sha256 === amendment001.sha256 && [2, 4].includes(citation.pdf_page_1based))
  );
  if (!basisSuperseded || !basisReplacementActive) {
    fail("CER_BASIS_REPLACEMENT_GATE_FAILED", "golden_validation");
  }

  const baseRows = new Set();
  const replacementRows = new Set();
  for (const fact of allFacts(analysis)) {
    const text = textOfFact(fact);
    const rowCandidates = new Set([
      ...(fact.citations ?? []).flatMap((citation) => {
        const sectionMatch = typeof citation.section === "string"
          ? citation.section.match(/(?:appendix\s*1\s*)?row\s*(\d{1,2})\b/i)
          : null;
        const quoteMatch = typeof citation.evidence_quote === "string"
          ? citation.evidence_quote.match(/^\s*(\d{1,2})\b/)
          : null;
        return [sectionMatch?.[1], quoteMatch?.[1]].filter(Boolean).map(Number);
      }),
      ...[text.match(/(?:appendix\s*1\s*)?row\s*(\d{1,2})\b/i)?.[1]].filter(Boolean).map(Number)
    ].filter((row) => row >= 1 && row <= 37));
    for (const row of rowCandidates) {
      if (fact.status === "superseded" && factHasCitation(fact, (citation) => citation.document_sha256 === base.sha256)) {
        baseRows.add(row);
      }
      if (fact.status === "active" && factHasCitation(fact, (citation) => citation.document_sha256 === amendment003.sha256)) {
        replacementRows.add(row);
      }
    }
  }
  if (baseRows.size !== 37 || replacementRows.size !== 37) {
    fail("CER_M3_REPLACEMENT_GATE_FAILED", "golden_validation");
  }

  const ratedThreshold = String(analysis.evaluation?.rated_threshold ?? "").replace(/\s+/g, "");
  if (
    analysis.evaluation?.mandatory_gate !== true || !ratedThreshold.includes("50/94") ||
    analysis.evaluation?.technical_weight !== 70 || analysis.evaluation?.financial_weight !== 30 ||
    !/highest combined rating/i.test(analysis.evaluation?.selection_method ?? "")
  ) {
    fail("CER_EVALUATION_GATE_FAILED", "golden_validation");
  }

  const horizonConflict = (Array.isArray(analysis.conflicts) ? analysis.conflicts : []).find((conflict) => {
    const candidates = new Set((conflict.candidate_values ?? []).map(String));
    const pages = citationPagesForSha(conflict, amendment003.sha256);
    return conflict.status === "conflicted" && candidates.size === 2 && candidates.has("2050") &&
      candidates.has("2055") && conflict.safe_answer ===
        "The supplied amendment is internally inconsistent; clarification is required." &&
      pages.size === 3 && [2, 5, 6].every((page) => pages.has(page));
  });
  if (!horizonConflict) fail("CER_INTERNAL_CONFLICT_GATE_FAILED", "golden_validation");

  return {
    golden_checks: 8,
    source_pages: 75,
    version_chain_verified: true,
    m3_base_rows_superseded: baseRows.size,
    m3_replacement_rows_active: replacementRows.size,
    conflict_citation_count: horizonConflict.citations.length
  };
}

function canonicalCitationLocator(citation) {
  return {
    document_sha256: citation.document_sha256,
    pdf_page_1based: citation.pdf_page_1based,
    verified: citation.verified,
    verification_method: citation.verification_method
  };
}

function semanticScalars(value) {
  const text = normalizeEvidenceText(value);
  const tokens = text.match(
    /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:t\d{1,2}:\d{2}(?::\d{2})?(?:z|[+-]\d{2}:?\d{2})?)?|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b|\b\d+(?:\.\d+)?\s*(?:%|\/\s*\d+|mdt|mst|est|edt|usd|cad|gbp)?\b/gi
  ) ?? [];
  return [...new Set(tokens.map((token) => token.replace(/\s+/g, "").toLowerCase()))].sort();
}

function semanticValuesFromItem(item) {
  const textValues = [
    item.claim_text,
    item.text,
    item.evidence_needed,
    item.consequence,
    item.finding,
    item.impact,
    item.recommended_action,
    item.topic
  ].filter((value) => typeof value === "string");
  return [...new Set(textValues.flatMap(semanticScalars))].sort();
}

function sortedProjection(items) {
  return items.map((item) => ({
    kind: item.claim_type ?? item.category ?? item.severity ?? null,
    status: item.status ?? null,
    semantic_values: semanticValuesFromItem(item),
    formula_and_inputs: item.formula_and_inputs ? {
      formula: normalizeEvidenceText(item.formula_and_inputs.formula),
      inputs: item.formula_and_inputs.inputs
    } : null,
    candidate_values: Array.isArray(item.candidate_values)
      ? item.candidate_values.map((value) => normalizeEvidenceText(value)).sort()
      : null,
    safe_answer: typeof item.safe_answer === "string"
      ? normalizeEvidenceText(item.safe_answer)
      : null,
    citations: (item.citations ?? []).map(canonicalCitationLocator)
      .sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
  })).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

export function criticalStructureFingerprint(analysis) {
  const projection = {
    package_completeness: analysis.package_completeness,
    manifest: (analysis.document_manifest ?? []).map((document) => ({
      role: document.role,
      sha256: document.sha256,
      pages: document.pages,
      amendment_number: document.amendment_number,
      status: document.status,
      cleanup_status: document.cleanup_status
    })).sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
    summary: {
      solicitation_number: analysis.summary?.solicitation_number ?? null,
      closing_date: analysis.summary?.closing_date ?? null,
      current_selection_method: analysis.summary?.current_selection_method ?? null
    },
    claims: sortedProjection(analysis.claims ?? []),
    requirements: sortedProjection(analysis.requirements ?? []),
    evaluation: {
      mandatory_gate: analysis.evaluation?.mandatory_gate ?? null,
      rated_threshold: analysis.evaluation?.rated_threshold ?? null,
      technical_weight: analysis.evaluation?.technical_weight ?? null,
      financial_weight: analysis.evaluation?.financial_weight ?? null,
      selection_method: analysis.evaluation?.selection_method ?? null,
      citations: (analysis.evaluation?.citations ?? []).map(canonicalCitationLocator)
        .sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
    },
    risks: sortedProjection(analysis.risks ?? []),
    conflicts: sortedProjection(analysis.conflicts ?? []),
    clarification_semantics: (analysis.clarification_questions ?? [])
      .flatMap(semanticScalars).sort(),
    blocking_unknown_semantics: (analysis.blocking_unknowns ?? [])
      .flatMap(semanticScalars).sort(),
    quality: {
      pages_total: analysis.quality?.pages_total,
      pages_covered: analysis.quality?.pages_covered,
      critical_claims: analysis.quality?.critical_claims,
      critical_claims_cited: analysis.quality?.critical_claims_cited,
      citations_verified: analysis.quality?.citations_verified,
      search_events: analysis.quality?.search_events,
      follow_embedded_link_events: analysis.quality?.follow_embedded_link_events
    }
  };
  return sha256Json(projection);
}

function aggregateProviderCosts(events) {
  const providers = {};
  for (const raw of events) {
    const event = asRecord(raw, "ANALYSIS_COST_EVENT_INVALID", "analysis_validation");
    if (
      !["monid", "openai", "railway_s3", "vercel_blob", "vercel", "neon"].includes(event.provider) ||
      !["succeeded", "failed"].includes(event.status) ||
      !(event.actual_micro_usd === null || isNonNegativeInteger(event.actual_micro_usd)) ||
      !(event.estimated_micro_usd === null || isNonNegativeInteger(event.estimated_micro_usd)) ||
      !isNonNegativeInteger(event.latency_ms)
    ) {
      fail("ANALYSIS_COST_EVENT_INVALID", "analysis_validation");
    }
    providers[event.provider] ??= {
      succeeded_calls: 0,
      failed_calls: 0,
      actual_micro_usd: 0,
      estimated_micro_usd: 0,
      latency_ms: 0
    };
    const bucket = providers[event.provider];
    bucket[event.status === "succeeded" ? "succeeded_calls" : "failed_calls"] += 1;
    bucket.actual_micro_usd += event.actual_micro_usd ?? 0;
    bucket.estimated_micro_usd += event.actual_micro_usd === null ? event.estimated_micro_usd ?? 0 : 0;
    bucket.latency_ms += event.latency_ms;
  }
  return providers;
}

function validateSample(sample, edmontonDocument, sourcePagesBySha) {
  const analysis = validateAnalysisEnvelope(
    sample,
    [edmontonDocument],
    sourcePagesBySha,
    { requireLiveCosts: false }
  );
  const golden = validateEdmontonGolden(analysis, edmontonDocument);
  if (analysis.costs.total_micro_usd !== 0 || analysis.costs.events.length !== 0) {
    fail("SAMPLE_TRIGGERED_COST", "sample_preflight");
  }
  return {
    contract_valid: true,
    deterministic_sample_cost_micro_usd: 0,
    golden_checks_passed: golden.golden_checks,
    citations_verified: analysis.quality.citations_verified
  };
}

export async function runReadOnlyPreflight(baseUrl, manifest, budgetPolicy, sourcePagesBySha) {
  const healthResponse = await requestJson(`${baseUrl}/api/health`, {
    stage: "health_preflight",
    acceptedStatuses: [200, 503],
    retries: 1
  });
  const health = asRecord(healthResponse.payload, "HEALTH_CONTRACT_INVALID", "health_preflight");
  const dependencies = asRecord(health.dependencies, "HEALTH_CONTRACT_INVALID", "health_preflight");
  const limits = asRecord(health.limits, "HEALTH_LIMITS_MISSING", "health_preflight");
  const expectedDependencies = {
    database: "ready",
    neon_capacity: "attested",
    maintenance: "fresh",
    private_storage: "attested",
    workflow: "attested_300s",
    monid: "actively_verified",
    openai: "actively_verified"
  };
  const dependenciesReady = Object.keys(dependencies).length ===
    Object.keys(expectedDependencies).length &&
    Object.entries(expectedDependencies).every(([name, status]) => dependencies[name] === status);
  if (
    !isNonNegativeInteger(limits.max_run_cost_micro_usd) || limits.max_run_cost_micro_usd === 0 ||
    !isNonNegativeInteger(limits.daily_cost_cap_micro_usd) || limits.daily_cost_cap_micro_usd === 0
  ) {
    fail("HEALTH_LIMITS_INVALID", "health_preflight");
  }
  const healthMetrics = {
    http_status: healthResponse.status,
    service_status: health.status,
    mode: health.mode,
    dependencies_ready: dependenciesReady,
    storage_provider: health.storage_provider,
    storage_safety: health.storage_safety,
    missing_count: Array.isArray(health.missing) ? health.missing.length : -1,
    document_only: health.source_scope === "document_only",
    provider_retention_disclosed: health.provider_retention === EXPECTED_PROVIDER_RETENTION,
    server_max_run_cost_micro_usd: limits.max_run_cost_micro_usd,
    server_daily_cost_cap_micro_usd: limits.daily_cost_cap_micro_usd
  };
  if (
    healthResponse.status !== 200 || health.status !== "ok" || health.mode !== "live" ||
    health.version !== "1.0" || !healthMetrics.dependencies_ready ||
    !["railway_s3", "vercel_blob"].includes(health.storage_provider) ||
    health.storage_safety !== "current" ||
    healthMetrics.missing_count !== 0 || !healthMetrics.document_only ||
    !healthMetrics.provider_retention_disclosed
  ) {
    fail("HEALTH_NOT_LIVE_READY", "health_preflight");
  }
  if (
    limits.max_run_cost_micro_usd > budgetPolicy.declaredPerRunCapMicroUsd ||
    limits.daily_cost_cap_micro_usd > budgetPolicy.totalBudgetMicroUsd
  ) {
    fail("SERVER_BUDGET_LIMIT_EXCEEDS_CAMPAIGN", "health_preflight");
  }

  const openApiResponse = await requestJson(`${baseUrl}/api/openapi.json`, {
    stage: "openapi_preflight",
    retries: 1
  });
  const openApi = asRecord(openApiResponse.payload, "OPENAPI_CONTRACT_INVALID", "openapi_preflight");
  const paths = asRecord(openApi.paths, "OPENAPI_CONTRACT_INVALID", "openapi_preflight");
  const schemes = openApi.components?.securitySchemes;
  if (
    openApi.openapi !== "3.1.0" || EXPECTED_API_PATHS.some((apiPath) => !paths[apiPath]) ||
    !schemes || typeof schemes !== "object" || !schemes.BearerAuth
  ) {
    fail("OPENAPI_CONTRACT_INVALID", "openapi_preflight");
  }
  const openApiMetrics = {
    version: openApi.openapi,
    required_paths_present: EXPECTED_API_PATHS.length,
    bearer_auth_declared: true
  };

  const edmontonDocument = manifest.documents.find((document) => document.id === "edmonton-100022184-a");
  if (!edmontonDocument) fail("EDMONTON_MANIFEST_MISSING", "sample_preflight");
  const sampleResponse = await requestJson(`${baseUrl}/api/v1/samples/edmonton`, {
    stage: "sample_preflight",
    retries: 1,
    timeoutMs: 60_000
  });
  return {
    health: healthMetrics,
    openapi: openApiMetrics,
    sample: validateSample(sampleResponse.payload, edmontonDocument, sourcePagesBySha)
  };
}

export function buildRunCases(manifest) {
  const byId = new Map(manifest.documents.map((document) => [document.id, document]));
  const edmonton = byId.get("edmonton-100022184-a");
  const cerOrder = [
    "cer-84084-26-0009-a-amendment-003",
    "cer-84084-26-0009-a-base",
    "cer-84084-26-0009-a-amendment-001",
    "cer-84084-26-0009-a-amendment-002"
  ];
  const cer = cerOrder.map((id) => byId.get(id));
  if (!edmonton || cer.some((document) => !document)) fail("MANIFEST_CASE_BUILD_FAILED", "configuration");
  const asInput = (document) => ({ role: document.role, source: { type: "url", url: document.url } });
  return [
    ...Array.from({ length: 10 }, (_, index) => ({
      caseId: `edmonton-${String(index + 1).padStart(2, "0")}`,
      packageId: "edmonton",
      expectedDocuments: [edmonton],
      body: { documents: [asInput(edmonton)] },
      qaPrompt: "What is the contract award selection method?",
      inputOrderScrambled: false,
      ingressMode: index === 9 ? "signed_put" : "official_url"
    })),
    {
      caseId: "cer-01",
      packageId: "cer",
      expectedDocuments: cer,
      body: { documents: cer.map(asInput) },
      qaPrompt: "What is the current solicitation closing deadline?",
      inputOrderScrambled: true,
      ingressMode: "official_url"
    }
  ];
}

function validateCreateResponse(payload) {
  const response = asRecord(payload, "CREATE_RESPONSE_INVALID", "run_create");
  if (
    typeof response.run_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(response.run_id) ||
    !RUN_STATUSES.has(response.status) || response.status_url !== `/api/v1/runs/${response.run_id}`
  ) {
    fail("CREATE_RESPONSE_INVALID", "run_create");
  }
  return response;
}

export async function createRunWithRecovery({
  baseUrl,
  apiKey,
  idempotencyKey,
  body,
  signal
}) {
  return requestJson(`${baseUrl}/api/v1/runs`, {
    stage: "run_create",
    method: "POST",
    headers: authHeaders(apiKey, {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey
    }),
    body: JSON.stringify(body),
    acceptedStatuses: [200, 202],
    // A lost response is not proof that admission failed. Re-send the exact
    // body/key until the durable idempotency record returns its original id.
    retries: 4,
    timeoutMs: 45_000,
    signal
  });
}

function validateRunStatus(payload, expectedRunId) {
  const status = asRecord(payload, "STATUS_RESPONSE_INVALID", "run_poll");
  if (
    status.run_id !== expectedRunId || !RUN_STATUSES.has(status.status) || !RUN_STATUSES.has(status.stage) ||
    !Number.isInteger(status.progress) || status.progress < 0 || status.progress > 100 ||
    typeof status.cleanup_confirmed !== "boolean" || !isNonNegativeInteger(status.cost_micro_usd)
  ) {
    fail("STATUS_RESPONSE_INVALID", "run_poll");
  }
  return status;
}

async function delay(milliseconds, signal) {
  if (signal?.aborted) fail("INTERRUPTED", "run_poll");
  await new Promise((resolve, reject) => {
    const onTimeout = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(onTimeout, milliseconds);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LiveVerificationError("INTERRUPTED", "run_poll"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function pollRun({ baseUrl, apiKey, runId, options, signal }) {
  const started = performance.now();
  const seenStages = new Map();
  let lastProgress = 0;
  while (performance.now() - started <= options.runTimeoutMs) {
    const response = await requestJson(`${baseUrl}/api/v1/runs/${runId}`, {
      stage: "run_poll",
      headers: authHeaders(apiKey),
      retries: 1,
      signal
    });
    const status = validateRunStatus(response.payload, runId);
    if (status.progress < lastProgress) fail("RUN_PROGRESS_REGRESSED", "run_poll");
    lastProgress = status.progress;
    if (!seenStages.has(status.stage)) {
      seenStages.set(status.stage, Math.round(performance.now() - started));
    }
    if (status.cost_micro_usd > options.declaredPerRunCapMicroUsd) {
      return {
        status,
        durationMs: Math.round(performance.now() - started),
        stageTimeline: [...seenStages].map(([stage, firstSeenElapsedMs]) => ({
          stage,
          first_seen_elapsed_ms: firstSeenElapsedMs
        })),
        capExceeded: true
      };
    }
    if (TERMINAL_STATUSES.has(status.status)) {
      return {
        status,
        durationMs: Math.round(performance.now() - started),
        stageTimeline: [...seenStages].map(([stage, firstSeenElapsedMs]) => ({
          stage,
          first_seen_elapsed_ms: firstSeenElapsedMs
        })),
        capExceeded: false
      };
    }
    await delay(options.pollIntervalMs, signal);
  }
  fail("RUN_TIMEOUT", "run_poll");
}

async function verifyQuestion({
  baseUrl,
  apiKey,
  runId,
  prompt,
  expectedHashes,
  sourcePagesBySha,
  signal
}) {
  const started = performance.now();
  const response = await requestJson(`${baseUrl}/api/v1/runs/${runId}/questions`, {
    stage: "question_verification",
    method: "POST",
    headers: authHeaders(apiKey, { "content-type": "application/json" }),
    body: JSON.stringify({ question: prompt }),
    retries: 1,
    timeoutMs: 20_000,
    signal
  });
  const answer = asRecord(response.payload, "QUESTION_RESPONSE_INVALID", "question_verification");
  if (
    answer.answerability !== "answered" || !Array.isArray(answer.citations) || answer.citations.length === 0 ||
    answer.citations.some((citation) => !validateCitation(citation, expectedHashes, sourcePagesBySha))
  ) {
    fail("QUESTION_GROUNDING_GATE_FAILED", "question_verification");
  }
  return {
    latency_ms: Math.round(performance.now() - started),
    result_class: "answered",
    citation_count: answer.citations.length,
    citations_verified: true,
    independent_source_matches: answer.citations.length
  };
}

async function cleanupRun({ baseUrl, apiKey, runId, timeoutMs }) {
  const started = performance.now();
  let attempts = 0;
  let lastHttpStatus = null;
  let lastRemoteErrorCode = null;
  while (performance.now() - started <= timeoutMs) {
    attempts += 1;
    try {
      const response = await requestJson(`${baseUrl}/api/v1/runs/${runId}`, {
        stage: "run_cleanup",
        method: "DELETE",
        headers: authHeaders(apiKey),
        acceptedStatuses: [204],
        timeoutMs: 20_000
      });
      return {
        attempted: true,
        confirmed: response.status === 204,
        attempts,
        latency_ms: Math.round(performance.now() - started),
        final_http_status: response.status,
        remote_error_code: null
      };
    } catch (error) {
      if (error instanceof HttpVerificationError) {
        lastHttpStatus = error.httpStatus;
        lastRemoteErrorCode = error.remoteErrorCode;
      }
      if (performance.now() - started >= timeoutMs) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, timeoutMs)));
    }
  }
  return {
    attempted: true,
    confirmed: false,
    attempts,
    latency_ms: Math.round(performance.now() - started),
    final_http_status: lastHttpStatus,
    remote_error_code: lastRemoteErrorCode
  };
}

async function cleanupObtainedRuns({ baseUrl, apiKey, runIds, timeoutMs }) {
  const uniqueRunIds = [...new Set(runIds)];
  if (uniqueRunIds.length === 0) {
    return {
      attempted: false,
      confirmed: true,
      run_count: 0,
      attempts: 0,
      latency_ms: 0,
      final_http_status: null,
      remote_error_code: null
    };
  }
  const started = performance.now();
  const results = [];
  for (const runId of uniqueRunIds) {
    results.push(await cleanupRun({ baseUrl, apiKey, runId, timeoutMs }));
  }
  const failed = results.find((result) => !result.confirmed);
  return {
    attempted: true,
    confirmed: results.every((result) => result.confirmed),
    run_count: uniqueRunIds.length,
    attempts: results.reduce((sum, result) => sum + result.attempts, 0),
    latency_ms: Math.round(performance.now() - started),
    final_http_status: failed?.final_http_status ?? 204,
    remote_error_code: failed?.remote_error_code ?? null
  };
}

function sanitizedFailure(error) {
  if (error instanceof HttpVerificationError) {
    return {
      code: error.code,
      stage: error.stage,
      http_status: error.httpStatus,
      remote_error_code: error.remoteErrorCode
    };
  }
  if (error instanceof LiveVerificationError) {
    return { code: error.code, stage: error.stage, http_status: null, remote_error_code: null };
  }
  return { code: "UNEXPECTED_FAILURE", stage: "unknown", http_status: null, remote_error_code: null };
}

function validatePresignResponse(payload) {
  const value = asRecord(payload, "PRESIGN_RESPONSE_INVALID", "signed_put_ingress");
  let uploadUrl;
  try {
    uploadUrl = new URL(value.upload_url);
  } catch {
    fail("PRESIGN_RESPONSE_INVALID", "signed_put_ingress");
  }
  if (
    typeof value.blob_path !== "string" || value.blob_path.length === 0 || value.blob_path.length > 512 ||
    uploadUrl.protocol !== "https:" || uploadUrl.username || uploadUrl.password ||
    value.method !== "PUT" || typeof value.expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= Date.now() ||
    !value.headers || typeof value.headers !== "object" || Array.isArray(value.headers) ||
    Object.entries(value.headers).some(([key, headerValue]) =>
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || typeof headerValue !== "string" ||
      /^(?:authorization|cookie|x-turnstile-token)$/i.test(key))
  ) {
    fail("PRESIGN_RESPONSE_INVALID", "signed_put_ingress");
  }
  const headers = new Headers(value.headers);
  if (headers.get("content-type")?.toLowerCase() !== "application/pdf") {
    fail("PRESIGN_RESPONSE_INVALID", "signed_put_ingress");
  }
  return { ...value, uploadUrl, headers };
}

async function putSignedPdf({ uploadUrl, headers, bytes, baseUrl, signal }) {
  const nonSafelistedHeaders = [...headers.keys()]
    .filter((header) => header.toLowerCase() !== "content-length");
  let preflight;
  try {
    preflight = await fetch(uploadUrl, {
      method: "OPTIONS",
      redirect: "error",
      headers: {
        origin: baseUrl,
        "access-control-request-method": "PUT",
        "access-control-request-headers": nonSafelistedHeaders.join(",")
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000)
    });
  } catch {
    fail("SIGNED_PUT_CORS_PREFLIGHT_FAILED", "signed_put_ingress");
  }
  const allowOrigin = preflight.headers.get("access-control-allow-origin");
  const allowMethods = preflight.headers.get("access-control-allow-methods") ?? "";
  const allowHeaders = preflight.headers.get("access-control-allow-headers") ?? "";
  const lowerAllowedHeaders = new Set(allowHeaders.toLowerCase().split(",").map((item) => item.trim()));
  if (
    ![200, 204].includes(preflight.status) || ![baseUrl, "*"].includes(allowOrigin ?? "") ||
    !allowMethods.split(",").some((method) => method.trim().toUpperCase() === "PUT") ||
    (allowHeaders !== "*" && nonSafelistedHeaders.some((header) => !lowerAllowedHeaders.has(header.toLowerCase())))
  ) {
    await preflight.body?.cancel();
    fail("SIGNED_PUT_CORS_PREFLIGHT_FAILED", "signed_put_ingress");
  }
  await preflight.body?.cancel();

  const performPut = async () => {
    const putHeaders = new Headers(headers);
    // Browsers attach Origin themselves. Node's release probe supplies the
    // same header so the actual response, not only OPTIONS, proves CORS.
    putHeaders.set("origin", baseUrl);
    return fetch(uploadUrl, {
      method: "PUT",
      redirect: "error",
      headers: putHeaders,
      body: bytes,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000)
    });
  };
  let first;
  try {
    first = await performPut();
  } catch {
    fail("SIGNED_PUT_FAILED", "signed_put_ingress");
  }
  if (
    ![200, 201, 204].includes(first.status) ||
    ![baseUrl, "*"].includes(first.headers.get("access-control-allow-origin") ?? "")
  ) {
    await first.body?.cancel();
    fail("SIGNED_PUT_FAILED", "signed_put_ingress");
  }
  await first.body?.cancel();

  let replay;
  try {
    replay = await performPut();
  } catch {
    fail("SIGNED_PUT_REPLAY_OUTCOME_UNKNOWN", "signed_put_ingress");
  }
  const replayRejected = [409, 412].includes(replay.status);
  await replay.body?.cancel();
  if (!replayRejected) fail("SIGNED_PUT_REPLAY_ACCEPTED", "signed_put_ingress");
  return { corsVerified: true, replayRejected: true };
}

export async function materializeRunCaseInput({ runCase, baseUrl, apiKey, fixtureDirectory, signal }) {
  if (runCase.ingressMode !== "signed_put") {
    return { body: runCase.body, corsVerified: false, replayRejected: false };
  }
  if (runCase.expectedDocuments.length !== 1) fail("SIGNED_PUT_CASE_INVALID", "signed_put_ingress");
  const document = runCase.expectedDocuments[0];
  const filename = FIXTURE_FILENAMES[document.id];
  if (!filename) fail("FIXTURE_MAPPING_MISSING", "signed_put_ingress");
  const fixturePath = path.join(fixtureDirectory, filename);
  let bytes;
  try {
    bytes = await readFile(fixturePath);
  } catch {
    fail("FIXTURE_MISSING", "signed_put_ingress");
  }
  if (bytes.byteLength !== document.bytes || sha256Text(bytes) !== document.sha256) {
    bytes.fill(0);
    fail("FIXTURE_CHANGED_AFTER_VERIFICATION", "signed_put_ingress");
  }
  try {
    const response = await requestJson(`${baseUrl}/api/v1/uploads/presign`, {
      stage: "signed_put_ingress",
      method: "POST",
      headers: authHeaders(apiKey, { "content-type": "application/json" }),
      body: JSON.stringify({ filename, size_bytes: bytes.byteLength, sha256: document.sha256 }),
      acceptedStatuses: [201],
      timeoutMs: 30_000,
      signal
    });
    const presign = validatePresignResponse(response.payload);
    const transfer = await putSignedPdf({
      uploadUrl: presign.uploadUrl,
      headers: presign.headers,
      bytes,
      baseUrl,
      signal
    });
    return {
      body: {
        documents: [{
          role: document.role,
          source: {
            type: "upload",
            blob_path: presign.blob_path,
            sha256: document.sha256,
            size_bytes: bytes.byteLength,
            filename
          }
        }]
      },
      corsVerified: transfer.corsVerified,
      replayRejected: transfer.replayRejected
    };
  } finally {
    bytes.fill(0);
  }
}

export function summarizeAttemptCost(cost, terminalReportedMicroUsd, declaredPerRunCapMicroUsd) {
  const reportedTotalMicroUsd = cost?.total_micro_usd ?? terminalReportedMicroUsd ?? null;
  const accountingComplete = cost?.completeness === "complete";
  const pessimisticReservedMicroUsd = accountingComplete
    ? 0
    : Math.max(reportedTotalMicroUsd ?? 0, declaredPerRunCapMicroUsd);
  return {
    accountingComplete,
    reportedTotalMicroUsd,
    pessimisticReservedMicroUsd,
    totalMicroUsd: accountingComplete
      ? reportedTotalMicroUsd ?? 0
      : pessimisticReservedMicroUsd
  };
}

export async function executeRunCase({
  runCase,
  attemptIndex,
  baseUrl,
  apiKey,
  campaignId,
  options,
  sourcePagesBySha,
  signal
}) {
  const started = performance.now();
  let requestBody = runCase.body;
  let idempotencyKey = null;
  let runId = null;
  const obtainedRunIds = new Set();
  let terminal = null;
  let analysis = null;
  let validation = null;
  let qa = null;
  let readyLatencyMs = null;
  let createReplayed = false;
  let sourceCitationAudit = null;
  let ingress = {
    mode: runCase.ingressMode ?? "official_url",
    cors_gate_passed: false,
    put_replay_rejected: false
  };
  let failure = null;
  let cleanup = {
    attempted: false,
    confirmed: true,
    run_count: 0,
    attempts: 0,
    latency_ms: 0,
    final_http_status: null,
    remote_error_code: null
  };
  try {
    const materialized = await materializeRunCaseInput({
      runCase,
      baseUrl,
      apiKey,
      fixtureDirectory: options.fixtureDirectory,
      signal
    });
    requestBody = materialized.body;
    ingress = {
      mode: runCase.ingressMode ?? "official_url",
      cors_gate_passed: materialized.corsVerified,
      put_replay_rejected: materialized.replayRejected
    };
    idempotencyKey =
      `rfp-xray-live:${campaignId}:${runCase.caseId}:${attemptIndex}:${sha256Json(requestBody).slice(0, 16)}`;
    const createResponse = await createRunWithRecovery({
      baseUrl,
      apiKey,
      idempotencyKey,
      body: requestBody,
      signal
    });
    for (const observedRunId of createResponse.obtainedRunIds) obtainedRunIds.add(observedRunId);
    createReplayed = createResponse.status === 200;
    // Capture a syntactically valid control identifier before validating the
    // rest of the response so malformed metadata cannot bypass cleanup.
    runId = possibleRunId(createResponse.payload);
    if (runId) obtainedRunIds.add(runId);
    const created = validateCreateResponse(createResponse.payload);
    runId = created.run_id;
    terminal = await pollRun({ baseUrl, apiKey, runId, options, signal });
    if (terminal.capExceeded) fail("DECLARED_PER_RUN_CAP_EXCEEDED", "run_poll");
    if (terminal.status.status !== "ready" || terminal.status.cleanup_confirmed !== true) {
      fail("RUN_NOT_CLEAN_READY", "run_terminal");
    }
    readyLatencyMs = Math.round(performance.now() - started);
    const analysisResponse = await requestJson(`${baseUrl}/api/v1/runs/${runId}/analysis`, {
      stage: "analysis_fetch",
      headers: authHeaders(apiKey),
      retries: 1,
      timeoutMs: 60_000,
      signal
    });
    analysis = validateAnalysisEnvelope(analysisResponse.payload, runCase.expectedDocuments, sourcePagesBySha);
    sourceCitationAudit = verifySourceCitations(analysis, runCase.expectedDocuments, sourcePagesBySha);
    if (terminal.status.cost_micro_usd !== analysis.costs.total_micro_usd) {
      fail("STATUS_ANALYSIS_COST_MISMATCH", "analysis_validation");
    }
    validation = runCase.packageId === "edmonton"
      ? validateEdmontonGolden(analysis, runCase.expectedDocuments[0])
      : validateCerGolden(analysis, runCase.expectedDocuments);
    qa = await verifyQuestion({
      baseUrl,
      apiKey,
      runId,
      prompt: runCase.qaPrompt,
      expectedHashes: new Set(runCase.expectedDocuments.map((document) => document.sha256)),
      sourcePagesBySha,
      signal
    });
  } catch (error) {
    if (error instanceof HttpVerificationError) {
      for (const observedRunId of error.possibleRunIds) obtainedRunIds.add(observedRunId);
      if (!runId) runId = error.possibleRunIds[0] ?? null;
    }
    failure = sanitizedFailure(error);
  } finally {
    cleanup = await cleanupObtainedRuns({
      baseUrl,
      apiKey,
      runIds: obtainedRunIds,
      timeoutMs: options.cleanupTimeoutMs
    });
    if (obtainedRunIds.size > 0 && !cleanup.confirmed && !failure) {
      failure = { code: "CLEANUP_UNCONFIRMED", stage: "run_cleanup", http_status: cleanup.final_http_status, remote_error_code: cleanup.remote_error_code };
    }
  }

  const cost = analysis?.costs ?? null;
  // Status totals and explicitly partial analysis ledgers lack complete
  // per-provider provenance. They reserve the full cap and cannot satisfy the
  // campaign's cost-accounting gate.
  const costSummary = summarizeAttemptCost(
    cost,
    terminal?.status.cost_micro_usd ?? null,
    options.declaredPerRunCapMicroUsd
  );
  const metric = {
    case_id: runCase.caseId,
    attempt_index: attemptIndex,
    package_id: runCase.packageId,
    input_order_scrambled: runCase.inputOrderScrambled,
    ingress_mode: ingress.mode,
    cors_gate_passed: ingress.cors_gate_passed,
    put_replay_rejected: ingress.put_replay_rejected,
    admission_replayed: createReplayed,
    run_id_sha256: runId ? sha256Text(runId) : null,
    obtained_run_count: obtainedRunIds.size,
    terminal_status: terminal?.status.status ?? null,
    cleanup_gate_confirmed_before_result: terminal?.status.cleanup_confirmed === true,
    elapsed_ms: Math.round(performance.now() - started),
    ready_latency_ms: readyLatencyMs,
    stage_timeline: terminal?.stageTimeline ?? [],
    cost_accounting_complete: costSummary.accountingComplete,
    cost: cost ? {
      actual_micro_usd: cost.actual_micro_usd,
      estimated_micro_usd: cost.estimated_micro_usd,
      reported_total_micro_usd: cost.total_micro_usd,
      pessimistic_reserved_micro_usd: costSummary.pessimisticReservedMicroUsd,
      total_micro_usd: costSummary.totalMicroUsd,
      includes_failed_attempts: cost.includes_failed_attempts,
      providers: aggregateProviderCosts(cost.events)
    } : {
      actual_micro_usd: null,
      estimated_micro_usd: null,
      reported_total_micro_usd: costSummary.reportedTotalMicroUsd,
      pessimistic_reserved_micro_usd: costSummary.pessimisticReservedMicroUsd,
      total_micro_usd: costSummary.totalMicroUsd,
      includes_failed_attempts: terminal?.status.status === "failed",
      providers: {}
    },
    validation: validation && qa && !failure ? {
      passed: true,
      golden_checks_passed: validation.golden_checks,
      source_pages: validation.source_pages,
      critical_structure_sha256: criticalStructureFingerprint(analysis),
      mandatory_active_count: validation.mandatory_active_count ?? null,
      version_chain_verified: validation.version_chain_verified ?? null,
      m3_base_rows_superseded: validation.m3_base_rows_superseded ?? null,
      m3_replacement_rows_active: validation.m3_replacement_rows_active ?? null,
      conflict_citation_count: validation.conflict_citation_count ?? null,
      critical_claims: analysis.quality.critical_claims,
      critical_claims_cited: analysis.quality.critical_claims_cited,
      citations_verified: analysis.quality.citations_verified,
      independent_source_matches: sourceCitationAudit.matched,
      source_surface_counts: sourceCitationAudit.bySurface,
      search_events: analysis.quality.search_events,
      follow_embedded_link_events: analysis.quality.follow_embedded_link_events
    } : { passed: false },
    qa,
    cleanup,
    failure
  };
  assertSanitizedMetrics(metric);
  return metric;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

export function aggregateMetrics(metrics) {
  const completedByCase = new Map();
  for (const run of metrics.runs) {
    if (run.validation?.passed && run.cleanup?.confirmed &&
      run.cost_accounting_complete === true && !run.failure) {
      completedByCase.set(run.case_id, run);
    }
  }
  const completed = [...completedByCase.values()];
  const edmonton = completed.filter((run) => run.package_id === "edmonton");
  const cer = completed.filter((run) => run.package_id === "cer");
  const fingerprints = new Set(edmonton.map((run) => run.validation.critical_structure_sha256));
  const totalCost = metrics.runs.reduce((sum, run) => sum + (run.cost?.total_micro_usd ?? 0), 0);
  const readyLatencies = edmonton.map((run) => run.ready_latency_ms).filter(Number.isInteger);
  const qaLatencies = completed.map((run) => run.qa?.latency_ms).filter(Number.isInteger);
  return {
    required_run_count: 11,
    attempt_count: metrics.runs.length,
    unresolved_attempt_count: metrics.runs.filter((run) => run.cost_accounting_complete !== true).length,
    completed_run_count: completed.length,
    edmonton_completed: edmonton.length,
    cer_completed: cer.length,
    signed_put_completed: completed.filter((run) =>
      run.ingress_mode === "signed_put" && run.cors_gate_passed && run.put_replay_rejected
    ).length,
    edmonton_structure_consistent: edmonton.length === 10 && fingerprints.size === 1,
    cleanup_confirmed_count: completed.filter((run) => run.cleanup.confirmed).length,
    total_cost_micro_usd: totalCost,
    edmonton_ready_median_ms: percentile(readyLatencies, 0.5),
    edmonton_ready_p95_ms: percentile(readyLatencies, 0.95),
    qa_p95_ms: percentile(qaLatencies, 0.95),
    performance_gate_passed: edmonton.length === 10 &&
      percentile(readyLatencies, 0.5) <= 6 * 60_000 && percentile(readyLatencies, 0.95) < 10 * 60_000 &&
      completed.length === 11 && percentile(qaLatencies, 0.95) < 20_000
  };
}

export function assertSanitizedMetrics(value, keyPath = "metrics") {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertSanitizedMetrics(value[index], `${keyPath}[${index}]`);
    }
    return true;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) fail("UNSAFE_METRIC_KEY", "metrics_write");
      assertSanitizedMetrics(child, `${keyPath}.${key}`);
    }
    return true;
  }
  if (typeof value === "string" && (value.length > 256 || SENSITIVE_STRING.test(value))) {
    fail("UNSAFE_METRIC_VALUE", "metrics_write");
  }
  return true;
}

async function atomicWriteMetrics(filePath, metrics) {
  assertSanitizedMetrics(metrics);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const handle = await open(temporaryPath, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
}

async function readExistingMetrics(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    assertSanitizedMetrics(parsed);
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof LiveVerificationError) throw error;
    fail("EXISTING_METRICS_INVALID", "metrics_resume");
  }
}

function newMetrics(options, fixtureMetrics, preflight) {
  return {
    schema_version: "1.1",
    evidence_kind: "paid_live_release_verification",
    campaign_id: options.campaignId,
    generated_at: new Date().toISOString(),
    verdict: "incomplete",
    failure: null,
    target_origin_sha256: sha256Text(options.baseUrl),
    fixtures: fixtureMetrics,
    preflight,
    policy: {
      paid_live_explicitly_allowed: options.allowPaidLive,
      total_budget_micro_usd: options.totalBudgetMicroUsd,
      declared_server_per_run_cap_micro_usd: options.declaredPerRunCapMicroUsd,
      calls_are_serial: true,
      idempotency_enabled: true,
      lost_response_recovery_attempts: 5,
      wallet_reconciliation_required: true,
      raw_artifacts_persisted: false
    },
    wallet: {
      before_micro_usd: null,
      after_micro_usd: null,
      reported_monid_spend_micro_usd: null,
      observed_debit_micro_usd: null,
      difference_micro_usd: null,
      reconciled: false
    },
    runs: [],
    aggregate: null
  };
}

function reconcileWallet(metrics, afterMicroUsd) {
  const before = metrics.wallet?.before_micro_usd;
  const reported = metrics.runs.reduce((total, run) =>
    total + (run.cost?.providers?.monid?.actual_micro_usd ?? 0), 0);
  const observed = isNonNegativeInteger(before) && isNonNegativeInteger(afterMicroUsd)
    ? before - afterMicroUsd
    : null;
  const difference = observed === null ? null : Math.abs(observed - reported);
  metrics.wallet = {
    before_micro_usd: before ?? null,
    after_micro_usd: afterMicroUsd,
    reported_monid_spend_micro_usd: reported,
    observed_debit_micro_usd: observed,
    difference_micro_usd: difference,
    reconciled: observed !== null && observed >= 0 && difference === 0
  };
}

function requireExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("EXISTING_METRICS_SHAPE_INVALID", "metrics_resume");
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("EXISTING_METRICS_EXTRA_OR_MISSING_FIELD", "metrics_resume");
  }
}

function validateResumedProviderMetrics(providers) {
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    fail("EXISTING_METRICS_PROVIDER_INVALID", "metrics_resume");
  }
  for (const [provider, bucket] of Object.entries(providers)) {
    if (!["monid", "openai", "railway_s3", "vercel_blob", "vercel", "neon"].includes(provider)) {
      fail("EXISTING_METRICS_PROVIDER_INVALID", "metrics_resume");
    }
    requireExactKeys(bucket, [
      "succeeded_calls", "failed_calls", "actual_micro_usd", "estimated_micro_usd", "latency_ms"
    ]);
    if (Object.values(bucket).some((value) => !isNonNegativeInteger(value))) {
      fail("EXISTING_METRICS_PROVIDER_INVALID", "metrics_resume");
    }
  }
}

function rebuildResumedRun(run) {
  const providers = Object.fromEntries(Object.entries(run.cost.providers).map(([provider, bucket]) => [
    provider,
    {
      succeeded_calls: bucket.succeeded_calls,
      failed_calls: bucket.failed_calls,
      actual_micro_usd: bucket.actual_micro_usd,
      estimated_micro_usd: bucket.estimated_micro_usd,
      latency_ms: bucket.latency_ms
    }
  ]));
  const validation = run.validation.passed ? {
    passed: true,
    golden_checks_passed: run.validation.golden_checks_passed,
    source_pages: run.validation.source_pages,
    critical_structure_sha256: run.validation.critical_structure_sha256,
    mandatory_active_count: run.validation.mandatory_active_count,
    version_chain_verified: run.validation.version_chain_verified,
    m3_base_rows_superseded: run.validation.m3_base_rows_superseded,
    m3_replacement_rows_active: run.validation.m3_replacement_rows_active,
    conflict_citation_count: run.validation.conflict_citation_count,
    critical_claims: run.validation.critical_claims,
    critical_claims_cited: run.validation.critical_claims_cited,
    citations_verified: run.validation.citations_verified,
    independent_source_matches: run.validation.independent_source_matches,
    source_surface_counts: Object.fromEntries(Object.entries(run.validation.source_surface_counts)),
    search_events: run.validation.search_events,
    follow_embedded_link_events: run.validation.follow_embedded_link_events
  } : { passed: false };
  return {
    case_id: run.case_id,
    attempt_index: run.attempt_index,
    package_id: run.package_id,
    input_order_scrambled: run.input_order_scrambled,
    ingress_mode: run.ingress_mode,
    cors_gate_passed: run.cors_gate_passed,
    put_replay_rejected: run.put_replay_rejected,
    admission_replayed: run.admission_replayed,
    run_id_sha256: run.run_id_sha256,
    obtained_run_count: run.obtained_run_count,
    terminal_status: run.terminal_status,
    cleanup_gate_confirmed_before_result: run.cleanup_gate_confirmed_before_result,
    elapsed_ms: run.elapsed_ms,
    ready_latency_ms: run.ready_latency_ms,
    stage_timeline: run.stage_timeline.map((stage) => ({
      stage: stage.stage,
      first_seen_elapsed_ms: stage.first_seen_elapsed_ms
    })),
    cost_accounting_complete: run.cost_accounting_complete,
    cost: {
      actual_micro_usd: run.cost.actual_micro_usd,
      estimated_micro_usd: run.cost.estimated_micro_usd,
      reported_total_micro_usd: run.cost.reported_total_micro_usd,
      pessimistic_reserved_micro_usd: run.cost.pessimistic_reserved_micro_usd,
      total_micro_usd: run.cost.total_micro_usd,
      includes_failed_attempts: run.cost.includes_failed_attempts,
      providers
    },
    validation,
    qa: run.qa === null ? null : {
      latency_ms: run.qa.latency_ms,
      result_class: run.qa.result_class,
      citation_count: run.qa.citation_count,
      citations_verified: run.qa.citations_verified,
      independent_source_matches: run.qa.independent_source_matches
    },
    cleanup: {
      attempted: run.cleanup.attempted,
      confirmed: run.cleanup.confirmed,
      run_count: run.cleanup.run_count,
      attempts: run.cleanup.attempts,
      latency_ms: run.cleanup.latency_ms,
      final_http_status: run.cleanup.final_http_status,
      remote_error_code: run.cleanup.remote_error_code
    },
    failure: run.failure === null ? null : {
      code: run.failure.code,
      stage: run.failure.stage,
      http_status: run.failure.http_status,
      remote_error_code: run.failure.remote_error_code
    }
  };
}

function mergeExistingMetrics(current, existing) {
  if (!existing) return current;
  if (
    existing.schema_version !== current.schema_version || existing.campaign_id !== current.campaign_id ||
    existing.target_origin_sha256 !== current.target_origin_sha256 ||
    existing.fixtures?.manifest_sha256 !== current.fixtures.manifest_sha256 ||
    existing.policy?.total_budget_micro_usd !== current.policy.total_budget_micro_usd ||
    existing.policy?.declared_server_per_run_cap_micro_usd !== current.policy.declared_server_per_run_cap_micro_usd ||
    !Array.isArray(existing.runs)
  ) {
    fail("EXISTING_METRICS_CONTEXT_MISMATCH", "metrics_resume");
  }
  const allowedCaseIds = new Set([
    ...Array.from({ length: 10 }, (_, index) => `edmonton-${String(index + 1).padStart(2, "0")}`),
    "cer-01"
  ]);
  const seenAttempts = new Set();
  const rebuiltRuns = [];
  for (const run of existing.runs) {
    requireExactKeys(run, [
      "case_id", "attempt_index", "package_id", "input_order_scrambled", "admission_replayed",
      "ingress_mode", "cors_gate_passed", "put_replay_rejected",
      "run_id_sha256", "obtained_run_count", "terminal_status",
      "cleanup_gate_confirmed_before_result", "elapsed_ms", "ready_latency_ms", "stage_timeline",
      "cost_accounting_complete", "cost", "validation", "qa", "cleanup", "failure"
    ]);
    requireExactKeys(run.cost, [
      "actual_micro_usd", "estimated_micro_usd", "reported_total_micro_usd",
      "pessimistic_reserved_micro_usd", "total_micro_usd", "includes_failed_attempts", "providers"
    ]);
    requireExactKeys(run.cleanup, [
      "attempted", "confirmed", "run_count", "attempts", "latency_ms", "final_http_status",
      "remote_error_code"
    ]);
    for (const stage of run.stage_timeline ?? []) {
      requireExactKeys(stage, ["stage", "first_seen_elapsed_ms"]);
    }
    if (run.failure !== null) {
      requireExactKeys(run.failure, ["code", "stage", "http_status", "remote_error_code"]);
    }
    if (run.qa !== null) {
      requireExactKeys(run.qa, [
        "latency_ms", "result_class", "citation_count", "citations_verified", "independent_source_matches"
      ]);
    }
    requireExactKeys(run.validation, run.validation?.passed === true
      ? [
          "passed", "golden_checks_passed", "source_pages", "critical_structure_sha256",
          "mandatory_active_count", "version_chain_verified", "m3_base_rows_superseded",
          "m3_replacement_rows_active", "conflict_citation_count", "critical_claims",
          "critical_claims_cited", "citations_verified", "independent_source_matches",
          "source_surface_counts",
          "search_events", "follow_embedded_link_events"
        ]
      : ["passed"]);
    validateResumedProviderMetrics(run.cost?.providers);
    if (run.validation?.passed === true) {
      requireExactKeys(run.validation.source_surface_counts, [
        "summary", "claims", "requirements", "evaluation", "risks", "conflicts",
        "clarification_questions", "blocking_unknowns"
      ]);
      if (Object.values(run.validation.source_surface_counts).some((value) => !isNonNegativeInteger(value))) {
        fail("EXISTING_METRICS_SOURCE_SURFACES_INVALID", "metrics_resume");
      }
    }
    const attemptKey = `${run?.case_id ?? "invalid"}:${run?.attempt_index ?? "invalid"}`;
    const isCer = run?.case_id === "cer-01";
    const failureIsValid = run.failure === null || (
      typeof run.failure === "object" && !Array.isArray(run.failure) &&
      typeof run.failure.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(run.failure.code) &&
      typeof run.failure.stage === "string" && /^[a-z0-9_-]{1,64}$/.test(run.failure.stage) &&
      (run.failure.http_status === null || isNonNegativeInteger(run.failure.http_status)) &&
      (run.failure.remote_error_code === null ||
        (typeof run.failure.remote_error_code === "string" &&
          /^[A-Z][A-Z0-9_]{1,63}$/.test(run.failure.remote_error_code)))
    );
    if (
      !run || typeof run !== "object" || !allowedCaseIds.has(run.case_id) ||
      run.attempt_index !== 1 || seenAttempts.has(attemptKey) ||
      !["edmonton", "cer"].includes(run.package_id) ||
      isCer !== (run.package_id === "cer") || run.input_order_scrambled !== isCer ||
      !["official_url", "signed_put"].includes(run.ingress_mode) ||
      typeof run.cors_gate_passed !== "boolean" || typeof run.put_replay_rejected !== "boolean" ||
      (run.ingress_mode === "signed_put" && run.case_id !== "edmonton-10") ||
      (run.ingress_mode === "official_url" && (run.cors_gate_passed || run.put_replay_rejected)) ||
      typeof run.admission_replayed !== "boolean" ||
      !(run.run_id_sha256 === null || (typeof run.run_id_sha256 === "string" && /^[a-f0-9]{64}$/.test(run.run_id_sha256))) ||
      !isNonNegativeInteger(run.obtained_run_count) ||
      !(run.terminal_status === null || RUN_STATUSES.has(run.terminal_status)) ||
      typeof run.cleanup_gate_confirmed_before_result !== "boolean" ||
      !isNonNegativeInteger(run.elapsed_ms) ||
      !(run.ready_latency_ms === null || isNonNegativeInteger(run.ready_latency_ms)) ||
      !Array.isArray(run.stage_timeline) || run.stage_timeline.some((stage) =>
        !stage || typeof stage !== "object" || !RUN_STATUSES.has(stage.stage) ||
        !isNonNegativeInteger(stage.first_seen_elapsed_ms)) ||
      !run.cost || !isNonNegativeInteger(run.cost.total_micro_usd) ||
      !(run.cost.actual_micro_usd === null || isNonNegativeInteger(run.cost.actual_micro_usd)) ||
      !(run.cost.estimated_micro_usd === null || isNonNegativeInteger(run.cost.estimated_micro_usd)) ||
      !(run.cost.reported_total_micro_usd === null || isNonNegativeInteger(run.cost.reported_total_micro_usd)) ||
      !isNonNegativeInteger(run.cost.pessimistic_reserved_micro_usd) ||
      typeof run.cost.includes_failed_attempts !== "boolean" ||
      !run.cost.providers || typeof run.cost.providers !== "object" || Array.isArray(run.cost.providers) ||
      typeof run.cost_accounting_complete !== "boolean" ||
      !run.validation || typeof run.validation.passed !== "boolean" ||
      !run.cleanup || typeof run.cleanup.attempted !== "boolean" || typeof run.cleanup.confirmed !== "boolean" ||
      !isNonNegativeInteger(run.cleanup.run_count) || run.cleanup.run_count !== run.obtained_run_count ||
      !isNonNegativeInteger(run.cleanup.attempts) || !isNonNegativeInteger(run.cleanup.latency_ms) ||
      !(run.cleanup.final_http_status === null || isNonNegativeInteger(run.cleanup.final_http_status)) ||
      !(run.cleanup.remote_error_code === null ||
        (typeof run.cleanup.remote_error_code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(run.cleanup.remote_error_code))) ||
      !failureIsValid ||
      (run.cost_accounting_complete === false && (
        run.cost.pessimistic_reserved_micro_usd <= 0 ||
        run.cost.total_micro_usd < run.cost.pessimistic_reserved_micro_usd)) ||
      (run.validation.passed === false && run.failure === null)
    ) {
      fail("EXISTING_METRICS_RUN_INVALID", "metrics_resume");
    }
    if (run.validation.passed === true && (
      run.terminal_status !== "ready" || run.cleanup_gate_confirmed_before_result !== true ||
      run.cleanup.confirmed !== true || run.failure !== null ||
      !isNonNegativeInteger(run.cost.actual_micro_usd) || !isNonNegativeInteger(run.cost.estimated_micro_usd) ||
      run.cost.reported_total_micro_usd !== run.cost.actual_micro_usd + run.cost.estimated_micro_usd ||
      run.cost.total_micro_usd !== (run.cost_accounting_complete
        ? run.cost.reported_total_micro_usd
        : run.cost.pessimistic_reserved_micro_usd) ||
      (run.cost_accounting_complete
        ? run.cost.pessimistic_reserved_micro_usd !== 0
        : run.cost.pessimistic_reserved_micro_usd <= 0) ||
      run.cost.includes_failed_attempts !== false ||
      !run.cost.providers.monid ||
      run.cost.providers.monid.succeeded_calls !== (isCer ? 4 : 1) ||
      run.cost.providers.monid.failed_calls !== 0 ||
      run.cost.providers.monid.estimated_micro_usd !== 0 ||
      Object.values(run.cost.providers).some((bucket) => bucket.failed_calls !== 0) ||
      run.obtained_run_count < 1 ||
      typeof run.validation.critical_structure_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(run.validation.critical_structure_sha256) ||
      run.validation.golden_checks_passed !== (isCer ? 8 : 7) ||
      run.validation.source_pages !== (isCer ? 75 : 55) ||
      !isNonNegativeInteger(run.validation.critical_claims) ||
      !isNonNegativeInteger(run.validation.critical_claims_cited) ||
      !isNonNegativeInteger(run.validation.citations_verified) ||
      !Number.isInteger(run.validation.independent_source_matches) ||
      run.validation.independent_source_matches <= 0 ||
      Object.values(run.validation.source_surface_counts).reduce((sum, value) => sum + value, 0) !==
        run.validation.independent_source_matches ||
      run.validation.critical_claims !== run.validation.critical_claims_cited ||
      run.validation.search_events !== 0 || run.validation.follow_embedded_link_events !== 0 ||
      (run.ingress_mode === "signed_put" && (!run.cors_gate_passed || !run.put_replay_rejected)) ||
      (!isCer && run.validation.mandatory_active_count !== 4) ||
      (isCer && (run.validation.version_chain_verified !== true ||
        run.validation.m3_base_rows_superseded !== 37 ||
        run.validation.m3_replacement_rows_active !== 37 ||
        !Number.isInteger(run.validation.conflict_citation_count) || run.validation.conflict_citation_count < 3)) ||
      !Number.isInteger(run.ready_latency_ms) || !run.qa || run.qa.result_class !== "answered" ||
      !Number.isInteger(run.qa.latency_ms) || !Number.isInteger(run.qa.citation_count) ||
      run.qa.citation_count <= 0 || run.qa.citations_verified !== true ||
      run.qa.independent_source_matches !== run.qa.citation_count
    )) {
      fail("EXISTING_METRICS_SUCCESS_INVALID", "metrics_resume");
    }
    seenAttempts.add(attemptKey);
    rebuiltRuns.push(rebuildResumedRun(run));
  }
  const wallet = existing.wallet;
  requireExactKeys(wallet, [
    "before_micro_usd", "after_micro_usd", "reported_monid_spend_micro_usd",
    "observed_debit_micro_usd", "difference_micro_usd", "reconciled"
  ]);
  if (
    !wallet || typeof wallet !== "object" || Array.isArray(wallet) ||
    !(wallet.before_micro_usd === null || isNonNegativeInteger(wallet.before_micro_usd)) ||
    !(wallet.after_micro_usd === null || isNonNegativeInteger(wallet.after_micro_usd)) ||
    !(wallet.reported_monid_spend_micro_usd === null || isNonNegativeInteger(wallet.reported_monid_spend_micro_usd)) ||
    !(wallet.observed_debit_micro_usd === null || Number.isInteger(wallet.observed_debit_micro_usd)) ||
    !(wallet.difference_micro_usd === null || isNonNegativeInteger(wallet.difference_micro_usd)) ||
    typeof wallet.reconciled !== "boolean" ||
    (wallet.reconciled === true && (
      !isNonNegativeInteger(wallet.before_micro_usd) || !isNonNegativeInteger(wallet.after_micro_usd) ||
      !isNonNegativeInteger(wallet.reported_monid_spend_micro_usd) ||
      !isNonNegativeInteger(wallet.observed_debit_micro_usd) || wallet.difference_micro_usd !== 0 ||
      wallet.before_micro_usd - wallet.after_micro_usd !== wallet.observed_debit_micro_usd ||
      wallet.observed_debit_micro_usd !== wallet.reported_monid_spend_micro_usd
    ))
  ) {
    fail("EXISTING_METRICS_WALLET_INVALID", "metrics_resume");
  }
  return {
    ...current,
    wallet: {
      before_micro_usd: wallet.before_micro_usd,
      after_micro_usd: wallet.after_micro_usd,
      reported_monid_spend_micro_usd: wallet.reported_monid_spend_micro_usd,
      observed_debit_micro_usd: wallet.observed_debit_micro_usd,
      difference_micro_usd: wallet.difference_micro_usd,
      reconciled: wallet.reconciled
    },
    runs: rebuiltRuns
  };
}

function releasePassed(metrics, options) {
  const aggregate = metrics.aggregate ?? aggregateMetrics(metrics);
  return aggregate.attempt_count === 11 && aggregate.completed_run_count === 11 && aggregate.edmonton_completed === 10 &&
    aggregate.cer_completed === 1 && aggregate.edmonton_structure_consistent &&
    aggregate.signed_put_completed === 1 &&
    aggregate.cleanup_confirmed_count === 11 && aggregate.unresolved_attempt_count === 0 &&
    metrics.wallet?.reconciled === true &&
    aggregate.total_cost_micro_usd <= options.totalBudgetMicroUsd &&
    aggregate.performance_gate_passed;
}

function logProgress(event, caseId = null) {
  const suffix = caseId ? ` ${caseId}` : "";
  process.stdout.write(`[live-verify] ${event}${suffix}\n`);
}

export async function main(environment = process.env) {
  let options;
  let evidencePath = null;
  let metrics = null;
  let currentStage = "configuration";
  const runAbort = new AbortController();
  const requestStop = () => runAbort.abort();
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  try {
    options = parseRuntimeOptions(environment);
    evidencePath = path.join(EVIDENCE_DIRECTORY, `live-verify-${options.campaignId}.json`);
    currentStage = "fixture_verification";
    logProgress("verifying-local-fixtures");
    const fixtures = await verifyOfficialFixtures({ fixtureDirectory: options.fixtureDirectory });
    metrics = newMetrics(options, fixtures.metrics, null);
    currentStage = "read_only_preflight";
    logProgress("running-read-only-preflight");
    const preflight = await runReadOnlyPreflight(
      options.baseUrl,
      fixtures.manifest,
      options,
      fixtures.sourcePagesBySha
    );
    metrics.preflight = preflight;
    metrics = mergeExistingMetrics(metrics, await readExistingMetrics(evidencePath));
    metrics.aggregate = aggregateMetrics(metrics);

    if (releasePassed(metrics, options)) {
      metrics.verdict = "pass";
      metrics.generated_at = new Date().toISOString();
      await atomicWriteMetrics(evidencePath, metrics);
      logProgress("already-complete");
      return 0;
    }

    if (!options.allowPaidLive) {
      metrics.verdict = "paid_gate_closed";
      metrics.generated_at = new Date().toISOString();
      await atomicWriteMetrics(evidencePath, metrics);
      logProgress("paid-gate-closed");
      return 2;
    }
    if (!options.apiKey) fail("API_KEY_REQUIRED_FOR_PAID_LIVE", "configuration");
    if (!options.monidApiKey) fail("MONID_API_KEY_REQUIRED_FOR_PAID_LIVE", "configuration");
    await assertPublicProductionOrigin(options.baseUrl);
    if (metrics.wallet.before_micro_usd === null) {
      if (metrics.runs.length > 0) {
        fail("MONID_WALLET_BASELINE_MISSING_NEW_CAMPAIGN_REQUIRED", "wallet_reconciliation");
      }
      metrics.wallet.before_micro_usd = await readMonidWalletBalance(options.monidApiKey);
      metrics.generated_at = new Date().toISOString();
      await atomicWriteMetrics(evidencePath, metrics);
    }

    const cases = buildRunCases(fixtures.manifest);
    for (const caseDefinition of cases) {
      if (runAbort.signal.aborted) fail("INTERRUPTED", "run_sequence");
      if (metrics.runs.some((run) => run.case_id === caseDefinition.caseId &&
        run.validation?.passed && run.cleanup?.confirmed && run.cost_accounting_complete === true)) {
        continue;
      }
      const priorAttempts = metrics.runs.filter((run) => run.case_id === caseDefinition.caseId);
      if (priorAttempts.length > 0) {
        fail("PREVIOUS_ATTEMPT_FAILED_NEW_CAMPAIGN_REQUIRED", "metrics_resume");
      }
      const spent = metrics.runs.reduce((sum, run) => sum + (run.cost?.total_micro_usd ?? 0), 0);
      if (spent + options.declaredPerRunCapMicroUsd > options.totalBudgetMicroUsd) {
        fail("RUNNER_BUDGET_RESERVE_UNAVAILABLE", "budget_gate");
      }
      currentStage = `run_${caseDefinition.caseId}`;
      logProgress("starting", caseDefinition.caseId);
      const attemptIndex = priorAttempts.length + 1;
      const pendingAttempt = {
        case_id: caseDefinition.caseId,
        attempt_index: attemptIndex,
        package_id: caseDefinition.packageId,
        input_order_scrambled: caseDefinition.inputOrderScrambled,
        ingress_mode: caseDefinition.ingressMode,
        cors_gate_passed: false,
        put_replay_rejected: false,
        admission_replayed: false,
        run_id_sha256: null,
        obtained_run_count: 0,
        terminal_status: null,
        cleanup_gate_confirmed_before_result: false,
        elapsed_ms: 0,
        ready_latency_ms: null,
        stage_timeline: [],
        cost_accounting_complete: false,
        cost: {
          actual_micro_usd: null,
          estimated_micro_usd: null,
          reported_total_micro_usd: null,
          pessimistic_reserved_micro_usd: options.declaredPerRunCapMicroUsd,
          total_micro_usd: options.declaredPerRunCapMicroUsd,
          includes_failed_attempts: false,
          providers: {}
        },
        validation: { passed: false },
        qa: null,
        cleanup: {
          attempted: false,
          confirmed: false,
          run_count: 0,
          attempts: 0,
          latency_ms: 0,
          final_http_status: null,
          remote_error_code: null
        },
        failure: {
          code: "ATTEMPT_OUTCOME_UNKNOWN",
          stage: "run_create",
          http_status: null,
          remote_error_code: null
        }
      };
      metrics.runs = [...metrics.runs, pendingAttempt].sort((left, right) =>
        left.case_id.localeCompare(right.case_id) || left.attempt_index - right.attempt_index
      );
      metrics.aggregate = aggregateMetrics(metrics);
      reconcileWallet(metrics, await readMonidWalletBalance(options.monidApiKey));
      metrics.generated_at = new Date().toISOString();
      await atomicWriteMetrics(evidencePath, metrics);
      const runMetric = await executeRunCase({
        runCase: caseDefinition,
        attemptIndex,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        campaignId: options.campaignId,
        options,
        sourcePagesBySha: fixtures.sourcePagesBySha,
        signal: runAbort.signal
      });
      metrics.runs = [...metrics.runs.filter((run) =>
        !(run.case_id === caseDefinition.caseId && run.attempt_index === attemptIndex)
      ), runMetric].sort((left, right) =>
        left.case_id.localeCompare(right.case_id) || left.attempt_index - right.attempt_index
      );
      metrics.aggregate = aggregateMetrics(metrics);
      metrics.generated_at = new Date().toISOString();
      await atomicWriteMetrics(evidencePath, metrics);
      if (
        runMetric.failure || !runMetric.validation.passed || !runMetric.cleanup.confirmed ||
        !runMetric.cost_accounting_complete
      ) {
        fail("LIVE_RUN_GATE_FAILED", currentStage);
      }
      if (caseDefinition.packageId === "edmonton") {
        const fingerprints = new Set(metrics.runs
          .filter((run) => run.package_id === "edmonton" && run.validation?.passed)
          .map((run) => run.validation.critical_structure_sha256));
        if (fingerprints.size > 1) fail("EDMONTON_CONSISTENCY_GATE_FAILED", currentStage);
      }
      logProgress("complete", caseDefinition.caseId);
    }

    metrics.aggregate = aggregateMetrics(metrics);
    reconcileWallet(metrics, await readMonidWalletBalance(options.monidApiKey));
    const passed = releasePassed(metrics, options);
    if (!passed) fail("AGGREGATE_RELEASE_GATE_FAILED", "aggregate_validation");
    metrics.verdict = "pass";
    metrics.failure = null;
    metrics.generated_at = new Date().toISOString();
    await atomicWriteMetrics(evidencePath, metrics);
    logProgress("pass");
    return 0;
  } catch (error) {
    const failure = sanitizedFailure(error);
    if (metrics && evidencePath) {
      if (options?.monidApiKey && isNonNegativeInteger(metrics.wallet?.before_micro_usd)) {
        try {
          reconcileWallet(metrics, await readMonidWalletBalance(options.monidApiKey));
        } catch {
          // Preserve the original failure and leave reconciliation incomplete.
        }
      }
      metrics.verdict = error?.code === "INTERRUPTED" ? "interrupted" : "fail";
      metrics.failure = failure;
      metrics.aggregate = aggregateMetrics(metrics);
      metrics.generated_at = new Date().toISOString();
      try {
        await atomicWriteMetrics(evidencePath, metrics);
      } catch {
        // Never print an underlying error: it could contain a provider URL.
      }
    }
    process.stderr.write(`[live-verify] stopped code=${failure.code} stage=${failure.stage || currentStage}\n`);
    return 1;
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    if (options) {
      options.apiKey = null;
      options.monidApiKey = null;
    }
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  process.exitCode = await main();
}
