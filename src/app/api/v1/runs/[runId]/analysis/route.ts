import { GET as getResult } from "@/app/api/v1/runs/[runId]/result/route";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  return getResult(request, context);
}
