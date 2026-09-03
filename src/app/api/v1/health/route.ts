import { jsonResponse } from "@/lib/api/http";
import { getConfig, getProductionReadiness, hasLivePipelineConfig } from "@/lib/config";

export const runtime = "nodejs";

export async function GET() {
  const config = getConfig();
  const livePipeline = hasLivePipelineConfig(config);
  const readiness = getProductionReadiness(config);
  const status = config.NODE_ENV === "production"
    ? (readiness.ready && livePipeline ? "ok" : "not_ready")
    : (livePipeline ? "ok" : "degraded");
  return jsonResponse({
    status,
    version: "1.0",
    mode: status === "not_ready" ? "unavailable" : livePipeline ? "live" : "local_fallback",
    dependencies: {
      database: config.DATABASE_URL ? "configured" : config.NODE_ENV === "production" ? "missing" : "memory_fallback",
      private_blob: config.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN ? "configured" : config.NODE_ENV === "production" ? "missing" : "memory_fallback",
      workflow: process.env.VERCEL ? "configured" : config.NODE_ENV === "production" ? "missing" : "microtask_fallback",
      monid: config.MONID_API_KEY ? "configured" : config.NODE_ENV === "production" ? "missing" : "local_fallback",
      openai: config.OPENAI_API_KEY ? "configured" : config.NODE_ENV === "production" ? "missing" : "local_fallback"
    },
    missing: readiness.missing,
    source_scope: "document_only",
    provider_retention: "unknown"
  }, { status: status === "not_ready" ? 503 : 200 });
}
