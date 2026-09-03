import { jsonResponse } from "@/lib/api/http";
import { createEdmontonSampleResult } from "@/lib/fixtures/edmonton";

export const runtime = "nodejs";

export async function GET() {
  return jsonResponse(createEdmontonSampleResult());
}
