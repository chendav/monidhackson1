import { apiErrorResponse, getOwnedRun, jsonResponse, noContentResponse } from "@/lib/api/http";
import { getRunStore } from "@/lib/runs/store";
import { toRunStatusResponse } from "@/lib/runs/types";
import { authenticateRequest, enforceMutationChallenge } from "@/lib/security/auth";
import { expireRun } from "@/lib/runs/expiry";

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
    await enforceMutationChallenge(request, principal);
    const store = await getRunStore();
    const record = await getOwnedRun(store, (await context.params).runId, principal);
    if (record.status === "expired") return noContentResponse(principal);
    await expireRun(record, store);
    return noContentResponse(principal);
  } catch (error) {
    return apiErrorResponse(error, principal);
  }
}
