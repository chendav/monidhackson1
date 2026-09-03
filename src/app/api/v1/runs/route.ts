import { apiErrorResponse, jsonResponse, readIdempotencyKey, readJson } from "@/lib/api/http";
import { createRun } from "@/lib/runs/create";
import { authenticateRequest, enforceMutationChallenge, MUTATION_ACTIONS } from "@/lib/security/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let principal;
  try {
    principal = authenticateRequest(request);
    await enforceMutationChallenge(request, principal, MUTATION_ACTIONS.createRun);
    const result = await createRun(
      await readJson(request),
      principal,
      readIdempotencyKey(request)
    );
    return jsonResponse(result.response, {
      status: result.created ? 202 : 200,
      principal,
      headers: { location: result.response.status_url }
    });
  } catch (error) {
    return apiErrorResponse(error, principal);
  }
}
