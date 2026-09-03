import { constantTimeHexEqual, hmacSha256Hex, sha256Hex } from "@/lib/crypto";
import { getConfig, type AppConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";

const COOKIE_NAME = "rfp_session";
const SESSION_SECONDS = 24 * 60 * 60;
const DEVELOPMENT_SECRET = "rfp-xray-local-session-secret-do-not-use-in-production";

interface SessionPayload {
  sub: string;
  exp: number;
}

export interface Principal {
  id: string;
  quotaKey: string;
  kind: "guest" | "api";
  setCookie?: string;
}

export const MUTATION_ACTIONS = {
  uploadPresign: "upload_presign",
  createRun: "create_run",
  askQuestion: "ask_question",
  deleteRun: "delete_run"
} as const;
export type MutationAction = typeof MUTATION_ACTIONS[keyof typeof MUTATION_ACTIONS];
export const TURNSTILE_TOKEN_HEADER = "x-turnstile-token";

function sessionSecret(config: AppConfig): string {
  if (config.SESSION_SIGNING_SECRET) {
    return config.SESSION_SIGNING_SECRET;
  }
  if (config.NODE_ENV === "production") {
    throw new AppError("ANALYSIS_INCOMPLETE", "Guest sessions are not configured.", {
      httpStatus: 503,
      retryable: true
    });
  }
  return DEVELOPMENT_SECRET;
}

export function uploadNamespaceSecret(config: AppConfig = getConfig()): string {
  return sessionSecret(config);
}

function encodeSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmacSha256Hex(secret, body)}`;
}

function decodeSession(value: string | undefined, secret: string): SessionPayload | undefined {
  if (!value) return undefined;
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra || !constantTimeHexEqual(signature, hmacSha256Hex(secret, body))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof parsed.sub !== "string" || typeof parsed.exp !== "number" || parsed.exp <= Date.now()) {
      return undefined;
    }
    return { sub: parsed.sub, exp: parsed.exp };
  } catch {
    return undefined;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie");
  if (!cookie) return undefined;
  for (const pair of cookie.split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function apiPrincipal(request: Request, config: AppConfig): Principal | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || !config.API_KEY_SHA256) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  const tokenHash = sha256Hex(token);
  if (!constantTimeHexEqual(tokenHash, config.API_KEY_SHA256)) {
    throw new AppError("RATE_LIMITED", "The API credential is invalid.", { httpStatus: 401 });
  }
  return { id: `api:${tokenHash.slice(0, 24)}`, quotaKey: `api:${tokenHash}`, kind: "api" };
}

function ipQuotaKey(request: Request, config: AppConfig): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "local";
  const secret = config.IP_HASH_SECRET ?? sessionSecret(config);
  return `ip:${hmacSha256Hex(secret, ip)}`;
}

export function authenticateRequest(
  request: Request,
  options: { createGuest?: boolean; config?: AppConfig } = {}
): Principal {
  const config = options.config ?? getConfig();
  const api = apiPrincipal(request, config);
  if (api) return api;

  const secret = sessionSecret(config);
  let session = decodeSession(readCookie(request, COOKIE_NAME), secret);
  let setCookie: string | undefined;
  if (!session) {
    if (options.createGuest === false) {
      throw new AppError("RATE_LIMITED", "A valid session or API credential is required.", {
        httpStatus: 401
      });
    }
    session = { sub: crypto.randomUUID(), exp: Date.now() + SESSION_SECONDS * 1000 };
    const secure = config.NODE_ENV === "production" ? "; Secure" : "";
    setCookie = `${COOKIE_NAME}=${encodeURIComponent(encodeSession(session, secret))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
  }

  return {
    id: `guest:${session.sub}`,
    quotaKey: ipQuotaKey(request, config),
    kind: "guest",
    setCookie
  };
}

export interface TurnstileVerifier {
  verify(input: {
    token: string;
    remoteIp?: string;
    expectedAction: MutationAction;
    expectedHostname: string;
  }): Promise<boolean>;
}

export class CloudflareTurnstileVerifier implements TurnstileVerifier {
  constructor(
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async verify(input: {
    token: string;
    remoteIp?: string;
    expectedAction: MutationAction;
    expectedHostname: string;
  }): Promise<boolean> {
    const body = new URLSearchParams({ secret: this.secret, response: input.token });
    if (input.remoteIp) body.set("remoteip", input.remoteIp);
    const response = await this.fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as {
      success?: unknown;
      action?: unknown;
      hostname?: unknown;
    };
    return payload.success === true &&
      payload.action === input.expectedAction &&
      typeof payload.hostname === "string" &&
      payload.hostname.toLowerCase() === input.expectedHostname.toLowerCase();
  }
}

export async function enforceMutationChallenge(
  request: Request,
  principal: Principal,
  expectedAction: MutationAction,
  verifier?: TurnstileVerifier,
  config = getConfig()
) {
  if (principal.kind === "api" || config.NODE_ENV !== "production") return;
  if (!config.TURNSTILE_SECRET_KEY || !config.TURNSTILE_EXPECTED_HOSTNAME) {
    throw new AppError("ANALYSIS_INCOMPLETE", "Guest abuse protection is not configured.", {
      httpStatus: 503,
      retryable: true
    });
  }
  const expectedHostname = config.TURNSTILE_EXPECTED_HOSTNAME.toLowerCase();
  if (new URL(request.url).hostname.toLowerCase() !== expectedHostname) {
    throw new AppError("RATE_LIMITED", "The request hostname is not allowed for this challenge.", {
      httpStatus: 403
    });
  }
  const token = request.headers.get(TURNSTILE_TOKEN_HEADER)?.trim();
  if (!token) {
    throw new AppError("RATE_LIMITED", "A Turnstile token is required.", { httpStatus: 403 });
  }
  const activeVerifier = verifier ?? new CloudflareTurnstileVerifier(config.TURNSTILE_SECRET_KEY);
  const remoteIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!(await activeVerifier.verify({
    token,
    remoteIp,
    expectedAction,
    expectedHostname
  }))) {
    throw new AppError("RATE_LIMITED", "The abuse-protection challenge was not accepted.", {
      httpStatus: 403
    });
  }
}
