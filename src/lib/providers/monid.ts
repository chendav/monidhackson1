import { z } from "zod";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getConfig, type AppConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";

const LifecycleStatusSchema = z.enum([
  "QUEUED",
  "PENDING",
  "RUNNING",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "CANCELED",
  "TIMED_OUT"
]);

export interface MonidParseInput {
  fileUrl: string;
  extension?: string;
  ocr?: boolean;
}

export interface MonidParseResult {
  markdown: string;
  runId: string;
  costMicroUsd: number | null;
  costCurrency: string | null;
  providerArtifactUrl: string;
  providerRetention: "unknown";
  terminalPayload: unknown;
}

export interface MonidInspectValidator {
  validate(payload: unknown): void;
}

export interface MonidAdapterOptions {
  config?: AppConfig;
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  inspectValidator?: MonidInspectValidator;
  pollIntervalMs?: number;
  maxPolls?: number;
  resolveHostname?: (hostname: string) => Promise<string[]>;
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function selectUniqueString(payload: unknown, configuredPath: string | undefined, paths: string[], label: string) {
  if (configuredPath) {
    const selected = getPath(payload, configuredPath);
    if (typeof selected !== "string" || !selected.trim()) {
      throw new AppError("MONID_PARSE_FAILED", `Monid ${label} was missing at the configured path.`);
    }
    return selected.trim();
  }
  const values = [...new Set(paths.map((path) => getPath(payload, path)).filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  ))];
  if (values.length !== 1) {
    throw new AppError(
      "MONID_PARSE_FAILED",
      `Monid ${label} could not be normalized unambiguously; configure its response path.`
    );
  }
  return values[0].trim();
}

function optionalNumberAt(payload: unknown, path: string | undefined, fallback: string): number | null {
  const value = getPath(payload, path ?? fallback);
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function resolveProviderEndpoint(config: AppConfig): { provider: string; endpoint: string } {
  if (config.MONID_PARSE_PROVIDER && config.MONID_PARSE_ENDPOINT) {
    return { provider: config.MONID_PARSE_PROVIDER, endpoint: config.MONID_PARSE_ENDPOINT };
  }
  const slug = config.MONID_PARSE_SLUG;
  if (slug) {
    const separator = slug.includes(":") ? ":" : "/";
    const index = slug.indexOf(separator);
    if (index > 0 && index < slug.length - 1) {
      return { provider: slug.slice(0, index), endpoint: slug.slice(index + 1) };
    }
  }
  throw new AppError(
    "MONID_PARSE_FAILED",
    "The credentialed Monid provider and endpoint have not been configured.",
    { httpStatus: 503 }
  );
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Response too large.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Response too large.");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export class MonidAdapter {
  private readonly config: AppConfig;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly inspectValidator?: MonidInspectValidator;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly resolveHostname: (hostname: string) => Promise<string[]>;

  constructor(options: MonidAdapterOptions = {}) {
    this.config = options.config ?? getConfig();
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.inspectValidator = options.inspectValidator;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.maxPolls = options.maxPolls ?? 120;
    this.resolveHostname = options.resolveHostname ?? (async (hostname) =>
      (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address));
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    if (!this.config.MONID_API_KEY) {
      throw new AppError("MONID_PARSE_FAILED", "Monid is not configured.", { httpStatus: 503 });
    }
    const response = await this.fetcher(new URL(path, this.config.MONID_API_BASE_URL), {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.MONID_API_KEY}`,
        "content-type": "application/json",
        accept: "application/json",
        ...init.headers
      },
      signal: init.signal ?? AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      throw new AppError("MONID_PARSE_FAILED", `Monid returned HTTP ${response.status}.`, {
        retryable: response.status === 429 || response.status >= 500
      });
    }
    const text = await boundedText(response, 1024 * 1024);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AppError("MONID_PARSE_FAILED", "Monid returned invalid JSON control data.");
    }
  }

  private async validateArtifactUrl(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new AppError("MONID_PARSE_FAILED", "Monid returned an invalid parse artifact URL.");
    }
    const allowedHosts = new Set((this.config.MONID_ARTIFACT_HOST_ALLOWLIST ?? "")
      .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password ||
      (url.port && url.port !== "443") || !allowedHosts.has(hostname)) {
      throw new AppError("MONID_PARSE_FAILED", "Monid returned a parse artifact URL outside the configured allowlist.");
    }
    const addresses = isIP(hostname) ? [hostname] : await this.resolveHostname(hostname);
    if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
      throw new AppError("MONID_PARSE_FAILED", "The parse artifact host did not resolve exclusively to public addresses.");
    }
    return url;
  }

  private async fetchArtifact(rawUrl: string): Promise<{ response: Response; url: URL }> {
    let current = await this.validateArtifactUrl(rawUrl);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await this.fetcher(current, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(20_000)
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === 3) {
          throw new AppError("MONID_PARSE_FAILED", "The parse artifact redirect chain was rejected.");
        }
        current = await this.validateArtifactUrl(new URL(location, current).toString());
        continue;
      }
      return { response, url: current };
    }
    throw new AppError("MONID_PARSE_FAILED", "The parse artifact redirect chain was rejected.");
  }

  async inspect(): Promise<unknown> {
    const { provider, endpoint } = resolveProviderEndpoint(this.config);
    const payload = await this.request("/v1/inspect", {
      method: "POST",
      body: JSON.stringify({ provider, endpoint })
    });
    this.inspectValidator?.validate(payload);
    return payload;
  }

  async parse(input: MonidParseInput): Promise<MonidParseResult> {
    const fileUrl = new URL(input.fileUrl);
    if (fileUrl.protocol !== "https:") {
      throw new AppError("MONID_PARSE_FAILED", "Monid parser input requires a short-lived HTTPS URL.");
    }
    const { provider, endpoint } = resolveProviderEndpoint(this.config);
    const started = await this.request("/v1/run", {
      method: "POST",
      body: JSON.stringify({
        provider,
        endpoint,
        input: {
          body: {
            file_url: fileUrl.toString(),
            extension: input.extension ?? "pdf",
            ocr: input.ocr ?? true,
            includeLinks: false,
            includeImages: false,
            shortenBase64Images: true,
            useMainContentOnly: false
          }
        }
      })
    });
    const runId = selectUniqueString(
      started,
      this.config.MONID_RUN_ID_PATH,
      ["runId", "run_id", "id", "data.runId", "data.id", "run.id"],
      "run id"
    );

    let terminal: unknown;
    for (let poll = 0; poll < this.maxPolls; poll += 1) {
      if (poll > 0) await this.sleep(this.pollIntervalMs);
      const payload = await this.request(`/v1/runs/${encodeURIComponent(runId)}`, { method: "GET" });
      const statusValue = selectUniqueString(
        payload,
        this.config.MONID_RUN_STATUS_PATH,
        ["status", "data.status", "run.status"],
        "lifecycle status"
      ).toUpperCase();
      const status = LifecycleStatusSchema.safeParse(statusValue);
      if (!status.success) {
        throw new AppError("MONID_PARSE_FAILED", "Monid returned an unknown lifecycle status.");
      }
      if (["FAILED", "CANCELLED", "CANCELED", "TIMED_OUT"].includes(status.data)) {
        throw new AppError("MONID_PARSE_FAILED", `Monid run ended with ${status.data}.`, {
          retryable: status.data === "TIMED_OUT"
        });
      }
      if (status.data === "COMPLETED") {
        terminal = payload;
        break;
      }
    }
    if (!terminal) {
      throw new AppError("MONID_PARSE_FAILED", "Monid parsing did not complete before the polling limit.", {
        retryable: true
      });
    }

    const providerStatusRaw = getPath(
      terminal,
      this.config.MONID_PROVIDER_STATUS_PATH ?? "result.status"
    );
    const providerStatus = typeof providerStatusRaw === "number"
      ? providerStatusRaw
      : Number(providerStatusRaw);
    if (!Number.isInteger(providerStatus) || providerStatus < 200 || providerStatus >= 300) {
      throw new AppError(
        "MONID_PARSE_FAILED",
        "Monid completed but the nested provider HTTP response was not a successful 2xx result."
      );
    }

    if (!this.config.MONID_RESULT_URL_PATH) {
      throw new AppError(
        "MONID_PARSE_FAILED",
        "The inspected Context.dev result URL path must be configured before live parsing."
      );
    }
    const providerArtifactUrl = selectUniqueString(
      terminal,
      this.config.MONID_RESULT_URL_PATH,
      [],
      "parse artifact URL"
    );
    const artifactResult = await this.fetchArtifact(providerArtifactUrl);
    const artifact = artifactResult.response;
    if (!artifact.ok) {
      throw new AppError("MONID_PARSE_FAILED", "The temporary parsed artifact could not be downloaded.", {
        retryable: artifact.status >= 500 || artifact.status === 429
      });
    }
    const markdown = await boundedText(artifact, 15 * 1024 * 1024);
    if (!markdown.trim()) throw new AppError("EMPTY_PARSE", "The parser returned no document text.");

    return {
      markdown,
      runId,
      costMicroUsd: optionalNumberAt(
        terminal,
        this.config.MONID_COST_VALUE_PATH,
        "cost.value"
      ),
      costCurrency: (() => {
        const value = getPath(terminal, this.config.MONID_COST_CURRENCY_PATH ?? "cost.currency");
        return typeof value === "string" ? value : null;
      })(),
      providerArtifactUrl: artifactResult.url.toString(),
      providerRetention: "unknown",
      terminalPayload: terminal
    };
  }
}

function isPublicAddress(address: string): boolean {
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
