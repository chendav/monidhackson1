import { PresignUploadRequestSchema, PresignUploadResponseSchema } from "@/contracts";
import { apiErrorResponse, jsonResponse, readJson } from "@/lib/api/http";
import { AppError } from "@/lib/errors";
import { authenticateRequest, enforceMutationChallenge, MUTATION_ACTIONS } from "@/lib/security/auth";
import { getUploadStorage } from "@/lib/storage/uploads";
import { scheduleIncomingUploadSweep } from "@/lib/runs/scheduler";
import { getConfig, getProductionReadiness } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let principal;
  try {
    principal = authenticateRequest(request);
    await enforceMutationChallenge(request, principal, MUTATION_ACTIONS.uploadPresign);
    const config = getConfig();
    if (!getProductionReadiness(config).ready) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The production upload service is not fully configured.", {
        httpStatus: 503,
        retryable: true
      });
    }
    const parsed = PresignUploadRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues.some((issue) => issue.path.at(-1) === "size_bytes" && issue.code === "too_big")
          ? "FILE_TOO_LARGE"
          : "UNSUPPORTED_MEDIA",
        parsed.error.issues.map((issue) => issue.message).join(" "),
        { httpStatus: 422 }
      );
    }
    const response = await getUploadStorage(config).presign(parsed.data, {
      ownerId: principal.id,
      origin: new URL(request.url).origin
    });
    await scheduleIncomingUploadSweep(response.expires_at);
    return jsonResponse(PresignUploadResponseSchema.parse(response), { status: 201, principal });
  } catch (error) {
    return apiErrorResponse(error, principal);
  }
}
