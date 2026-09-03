import { apiErrorResponse, getOwnedRun, jsonResponse, noContentResponse } from "@/lib/api/http";
import { AppError } from "@/lib/errors";
import { getRunStore } from "@/lib/runs/store";
import { toRunStatusResponse } from "@/lib/runs/types";
import { authenticateRequest, enforceMutationChallenge, MUTATION_ACTIONS } from "@/lib/security/auth";
import { expireRun } from "@/lib/runs/expiry";
import { scheduleCleanupRetry } from "@/lib/runs/scheduler";

export const runtime = "nodejs";

type Context = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: Context) {
  let principal;
  try {
    principal = authenticateRequest(request);
    const store = await getRunStore();
    const record = await getOwnedRun(store, (await context.params).runId, principal);
    return jsonResponse(toRunStatusResponse(record), { principal });
  } catch (error) {
    return apiErrorResponse(error, principal);
  }
}

export async function DELETE(request: Request, context: Context) {
  let principal;
  try {
    principal = authenticateRequest(request);
    await enforceMutationChallenge(request, principal, MUTATION_ACTIONS.deleteRun);
    const store = await getRunStore();
    const record = await getOwnedRun(store, (await context.params).runId, principal);
    if (record.status === "expired") return noContentResponse(principal);
    const expired = await expireRun(record, store);
    if (expired.status !== "expired" || !expired.cleanupConfirmed) {
      await scheduleCleanupRetry(expired.id);
      throw new AppError(
        "SOURCE_CLEANUP_PENDING",
        "Deletion was requested, but application-controlled cleanup is not yet confirmed.",
        { httpStatus: 503, retryable: true }
      );
    }
    return noContentResponse(principal);
  } catch (error) {
    return apiErrorResponse(error, principal);
  }
}
