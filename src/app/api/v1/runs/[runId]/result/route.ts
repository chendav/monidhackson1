import { AnalysisResultSchema } from "@/contracts";
import { apiErrorResponse, getOwnedRun, jsonResponse } from "@/lib/api/http";
import { AppError } from "@/lib/errors";
import { getRunStore } from "@/lib/runs/store";
import { toRunStatusResponse } from "@/lib/runs/types";
import { authenticateRequest } from "@/lib/security/auth";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  let principal;
  try {
    principal = authenticateRequest(request);
    const store = await getRunStore();
    const record = await getOwnedRun(store, (await context.params).runId, principal);
    if (record.status === "expired") {
      throw new AppError("ANALYSIS_INCOMPLETE", "The run result has expired.", { httpStatus: 410 });
    }
    if (!record.result) {
      return jsonResponse(toRunStatusResponse(record), { status: 202, principal });
    }
    return jsonResponse(AnalysisResultSchema.parse(record.result), { principal });
  } catch (error) {
    return apiErrorResponse(error, principal);
  }
}
