const SENSITIVE_KEY = /(?:authorization|cookie|token|secret|signed|source_url|upload_url|raw|markdown|pdf)/i;

export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[TRUNCATED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactForLog(item, depth + 1)
      ])
    );
  }
  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 120)}…[REDACTED ${value.length - 120} chars]`;
  }
  return value;
}

export function auditLog(event: string, details: Record<string, unknown>) {
  const redacted = redactForLog(details) as Record<string, unknown>;
  console.info(JSON.stringify({ event, at: new Date().toISOString(), ...redacted }));
}
