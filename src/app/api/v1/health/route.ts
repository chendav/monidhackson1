import { jsonResponse } from "@/lib/api/http";
import { getConfig, hasLivePipelineConfig } from "@/lib/config";

export const runtime = "nodejs";

export async function GET() {
  const config = getConfig();
  const livePipeline = hasLivePipelineConfig(config);
  return jsonResponse({
    status: livePipeline ? "ok" : "degraded",
    version: "1.0",
    mode: livePipeline ? "live" : "local_fallback",
    dependencies: {
      database: config.DATABASE_URL ? "configured" : "memory_fallback",
      private_blob: config.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN ? "configured" : "memory_fallback",
      monid: config.MONID_API_KEY ? "configured" : "local_fallback",
      openai: config.OPENAI_API_KEY ? "configured" : "local_fallback"
    },
    source_scope: "document_only",
    provider_retention: "unknown"
  });
}
