import { z } from "zod";
import { asAppError, errorBody, AppError } from "@/lib/errors";
import type { Principal } from "@/lib/security/auth";
import type { RunStore } from "@/lib/runs/store";
import { expireRun } from "@/lib/runs/expiry";

const IdSchema = z.uuid();

export function jsonResponse(
  body: unknown,
  options: { status?: number; principal?: Principal; headers?: HeadersInit } = {}
) {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  if (options.principal?.setCookie) headers.append("set-cookie", options.principal.setCookie);
  return new Response(JSON.stringify(body), { status: options.status ?? 200, headers });
}

export function noContentResponse(principal?: Principal) {
  const headers = new Headers({ "cache-control": "no-store" });
  if (principal?.setCookie) headers.append("set-cookie", principal.setCookie);
  return new Response(null, { status: 204, headers });
}

export function apiErrorResponse(error: unknown, principal?: Principal) {
  const appError = asAppError(error);
  return jsonResponse(errorBody(appError), {
    status: appError.httpStatus,
    principal,
    headers: appError.httpStatus === 429 ? { "retry-after": "60" } : undefined
  });
}

export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    throw new AppError("UNSUPPORTED_MEDIA", "The JSON request body is too large.", { httpStatus: 413 });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new AppError("UNSUPPORTED_MEDIA", "The JSON request body is too large.", { httpStatus: 413 });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new AppError("UNSUPPORTED_MEDIA", "A valid JSON body is required.", {
      httpStatus: 400,
      cause
    });
  }
}

export function parseRunId(value: string): string {
  const parsed = IdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
  }
  return parsed.data;
}

export async function getOwnedRun(store: RunStore, runId: string, principal: Principal) {
  let record = await store.get(parseRunId(runId));
  if (!record || record.ownerId !== principal.id) {
    throw new AppError("ANALYSIS_INCOMPLETE", "The run was not found.", { httpStatus: 404 });
  }
  if (record.status !== "expired" && new Date(record.expiresAt) <= new Date()) {
    record = await expireRun(record, store);
  }
  return record;
}

export function readIdempotencyKey(request: Request): string | null {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value) return null;
  if (value.length < 8 || value.length > 200 || !/^[\x21-\x7e]+$/.test(value)) {
    throw new AppError("ANALYSIS_INCOMPLETE", "Idempotency-Key must contain 8-200 visible ASCII characters.", {
      httpStatus: 400
    });
  }
  return value;
}
