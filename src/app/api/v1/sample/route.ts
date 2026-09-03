import { jsonResponse } from "@/lib/api/http";
import { createEdmontonSampleResult } from "@/lib/fixtures/edmonton";

export const runtime = "nodejs";

export async function GET() {
  return jsonResponse(createEdmontonSampleResult(), {
    headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" }
  });
}
