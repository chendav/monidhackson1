import { z } from "zod";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getConfig, type AppConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { isGloballyReachableIpAddress } from "@/lib/security/public-network";
import { monidInspectSemanticContractSha256 } from "@/lib/providers/monid-inspect-contract.mjs";

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
type LifecycleStatus = z.infer<typeof LifecycleStatusSchema>;

export class MonidTerminalProviderError extends AppError {
  readonly terminalProviderFailure = true;

  constructor(
    message: string,
    readonly providerRunId: string,
    readonly lifecycleStatus: LifecycleStatus | "NESTED_HTTP_FAILURE",
    readonly costAmount: number | null,
    readonly costCurrency: string | null,
    readonly costProvenance: MonidCostProvenance | null,
    options: { retryable?: boolean } = {}
  ) {
    super("MONID_PARSE_FAILED", message, { retryable: options.retryable });
    this.name = "MonidTerminalProviderError";
  }
}

export interface MonidParseInput {
  fileUrl: string;
  extension?: string;
  ocr?: boolean;
  /** Runs after control-plane validation and immediately before paid POST. */
  beforePaidDispatch?: () => Promise<void>;
}

export interface MonidCostProvenance {
  kind: "credentialed_inspect";
  inspect_schema_sha256: string;
  value_path: string;
  currency_path: string;
  value_unit: "currency_major" | "micro_dollar";
  source_value: number;
  source_currency: "USD";
}

export interface MonidParseResult {
  markdown: string;
  runId: string;
  /** Numeric value exactly as returned at the inspected Monid cost path. */
  costAmount: number | null;
  costValueUnit: "currency_major" | "micro_dollar" | null;
  costCurrency: string | null;
  costProvenance: MonidCostProvenance | null;
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

const PRODUCTION_MONID_ORIGIN = "https://api.monid.ai";

export function monidInspectResponseSha256(payload: unknown) {
  return monidInspectSemanticContractSha256(payload);
}

interface ValidatedMonidCostContract {
  inspectSchemaSha256: string;
  valuePath: string;
  currencyPath: string;
  valueUnit: "currency_major" | "micro_dollar";
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
  private validatedCostContractPromise: Promise<ValidatedMonidCostContract | null> | undefined;

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

  private terminalProviderError(
    message: string,
    runId: string,
    lifecycleStatus: LifecycleStatus | "NESTED_HTTP_FAILURE",
    terminal: unknown,
    contract: ValidatedMonidCostContract | null,
    retryable = false
  ) {
    const costAmount = optionalNumberAt(
      terminal,
      this.config.MONID_COST_VALUE_PATH,
      "cost.value"
    );
    const currency = getPath(
      terminal,
      this.config.MONID_COST_CURRENCY_PATH ?? "cost.currency"
    );
    const normalizedCurrency = typeof currency === "string" ? currency.trim().toUpperCase() : null;
    const costProvenance = contract && costAmount !== null && normalizedCurrency === "USD"
      ? {
          kind: "credentialed_inspect" as const,
          inspect_schema_sha256: contract.inspectSchemaSha256,
          value_path: contract.valuePath,
          currency_path: contract.currencyPath,
          value_unit: contract.valueUnit,
          source_value: costAmount,
          source_currency: "USD" as const
        }
      : null;
    return new MonidTerminalProviderError(
      message,
      runId,
      lifecycleStatus,
      costAmount,
      normalizedCurrency,
      costProvenance,
      { retryable }
    );
  }

  /**
   * Bearer credentials may only be sent to the exact Monid control-plane
   * origin. Resolve the hostname immediately before every request so a
   * private/special-use answer fails closed before the Authorization header is
   * constructed. Redirects are deliberately disabled in `request`.
   */
  private async validateControlPlaneUrl(path: string): Promise<URL> {
    let base: URL;
    try {
      base = new URL(this.config.MONID_API_BASE_URL);
    } catch {
      throw new AppError("MONID_PARSE_FAILED", "The Monid API origin is invalid.", { httpStatus: 503 });
    }
    const isBareHttpsOrigin = base.protocol === "https:" && !base.username && !base.password &&
      !base.port && base.pathname === "/" && !base.search && !base.hash;
    if (!isBareHttpsOrigin ||
      (this.config.NODE_ENV === "production" && base.origin !== PRODUCTION_MONID_ORIGIN)) {
      throw new AppError(
        "MONID_PARSE_FAILED",
        "The Monid API origin is outside the permitted production control plane.",
        { httpStatus: 503 }
      );
    }
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new AppError("MONID_PARSE_FAILED", "The Monid API request path is invalid.");
    }
    const target = new URL(path, base);
    if (target.origin !== base.origin || target.username || target.password || target.hash) {
      throw new AppError("MONID_PARSE_FAILED", "The Monid API request target is invalid.");
    }
    let addresses: string[];
    try {
      addresses = isIP(target.hostname)
        ? [target.hostname]
        : await this.resolveHostname(target.hostname);
    } catch (cause) {
      throw new AppError(
        "MONID_PARSE_FAILED",
        "The Monid API host could not be resolved safely.",
        { httpStatus: 503, retryable: true, cause }
      );
    }
    if (addresses.length === 0 || addresses.some((address) => !isGloballyReachableIpAddress(address))) {
      throw new AppError(
        "MONID_PARSE_FAILED",
        "The Monid API host did not resolve exclusively to public addresses.",
        { httpStatus: 503 }
      );
    }
    return target;
  }

  private async request(
    path: string,
    init: RequestInit,
    beforeDispatch?: () => Promise<void>
  ): Promise<unknown> {
    if (!this.config.MONID_API_KEY) {
      throw new AppError("MONID_PARSE_FAILED", "Monid is not configured.", { httpStatus: 503 });
    }
    const target = await this.validateControlPlaneUrl(path);
    await beforeDispatch?.();
    const response = await this.fetcher(target, {
      ...init,
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        authorization: `Bearer ${this.config.MONID_API_KEY}`,
        "content-type": "application/json",
        accept: "application/json",
        ...init.headers
      },
      signal: init.signal ?? AbortSignal.timeout(20_000)
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new AppError("MONID_PARSE_FAILED", "The Monid control-plane redirect was rejected.");
    }
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
    if (addresses.length === 0 || addresses.some((address) => !isGloballyReachableIpAddress(address))) {
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

  /**
   * A configured path/unit/hash is only an operator assertion. Bind cost
   * provenance to a credentialed inspect response fetched in this adapter
   * lifetime, and fail before the paid run when its pinned semantic contract
   * changed. Volatile telemetry and reviewed catalog presentation fields are
   * outside this versioned fingerprint.
   */
  async validateCurrentCostContract(): Promise<ValidatedMonidCostContract | null> {
    this.validatedCostContractPromise ??= (async () => {
      const inspectSchemaSha256 = this.config.MONID_INSPECT_SCHEMA_SHA256;
      const valuePath = this.config.MONID_COST_VALUE_PATH;
      const currencyPath = this.config.MONID_COST_CURRENCY_PATH;
      const valueUnit = this.config.MONID_COST_VALUE_UNIT;
      if (!inspectSchemaSha256 || !valuePath || !currencyPath || !valueUnit) {
        if (this.config.NODE_ENV === "production") {
          throw new AppError(
            "MONID_PARSE_FAILED",
            "The credentialed Monid cost contract is not configured for production.",
            { httpStatus: 503, retryable: false }
          );
        }
        return null;
      }
      const payload = await this.inspect();
      let currentInspectSchemaSha256: string;
      try {
        currentInspectSchemaSha256 = monidInspectResponseSha256(payload);
      } catch (cause) {
        throw new AppError(
          "MONID_PARSE_FAILED",
          "The current credentialed Monid inspect response has an invalid semantic contract.",
          { httpStatus: 503, retryable: false, cause }
        );
      }
      if (currentInspectSchemaSha256 !== inspectSchemaSha256) {
        throw new AppError(
          "MONID_PARSE_FAILED",
          "The current credentialed Monid inspect response does not match the pinned contract.",
          { httpStatus: 503, retryable: false }
        );
      }
      return { inspectSchemaSha256, valuePath, currencyPath, valueUnit };
    })();
    return this.validatedCostContractPromise;
  }

  async parse(input: MonidParseInput): Promise<MonidParseResult> {
    const fileUrl = new URL(input.fileUrl);
    if (fileUrl.protocol !== "https:") {
      throw new AppError("MONID_PARSE_FAILED", "Monid parser input requires a short-lived HTTPS URL.");
    }
    const costContract = await this.validateCurrentCostContract();
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
    }, input.beforePaidDispatch);
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
        throw this.terminalProviderError(
          `Monid run ended with ${status.data}.`,
          runId,
          status.data,
          payload,
          costContract,
          status.data === "TIMED_OUT"
        );
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
      throw this.terminalProviderError(
        "Monid completed but the nested provider HTTP response was not a successful 2xx result.",
        runId,
        "NESTED_HTTP_FAILURE",
        terminal,
        costContract
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

    const costAmount = optionalNumberAt(
      terminal,
      this.config.MONID_COST_VALUE_PATH,
      "cost.value"
    );
    const costCurrencyValue = getPath(
      terminal,
      this.config.MONID_COST_CURRENCY_PATH ?? "cost.currency"
    );
    const costCurrency = typeof costCurrencyValue === "string"
      ? costCurrencyValue.trim().toUpperCase()
      : null;
    const costValueUnit = costContract?.valueUnit ?? null;
    const costProvenance = costAmount !== null && costCurrency === "USD" && costContract
      ? {
          kind: "credentialed_inspect" as const,
          inspect_schema_sha256: costContract.inspectSchemaSha256,
          value_path: costContract.valuePath,
          currency_path: costContract.currencyPath,
          value_unit: costContract.valueUnit,
          source_value: costAmount,
          source_currency: "USD" as const
        }
      : null;

    return {
      markdown,
      runId,
      costAmount,
      costValueUnit,
      costCurrency,
      costProvenance,
      providerArtifactUrl: artifactResult.url.toString(),
      providerRetention: "unknown",
      terminalPayload: terminal
    };
  }
}
