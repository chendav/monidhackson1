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
    if (!record.cleanupConfirmed || !["ready", "partial"].includes(record.status)) {
      if (record.status === "cleanup_pending") {
        throw new AppError(
          "SOURCE_CLEANUP_PENDING",
          "Analysis remains unavailable until application-controlled cleanup is confirmed.",
          { httpStatus: 409, retryable: true }
        );
      }
      return jsonResponse(toRunStatusResponse(record), { status: 202, principal });
    }
    if (!record.result) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The completed run has no publishable analysis.", {
        httpStatus: 409
      });
    }
    return jsonResponse(AnalysisResultSchema.parse(record.result), { principal });
  } catch (error) {
    return apiErrorResponse(error, principal);
  }
}
