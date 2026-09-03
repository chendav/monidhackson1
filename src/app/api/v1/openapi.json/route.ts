import { jsonResponse } from "@/lib/api/http";
import { buildOpenApiDocument } from "@/lib/api/openapi";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return jsonResponse(buildOpenApiDocument(new URL(request.url).origin), {
    headers: { "access-control-allow-origin": "*" }
  });
}
