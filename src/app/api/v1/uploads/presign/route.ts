import { PresignUploadRequestSchema, PresignUploadResponseSchema } from "@/contracts";
import { apiErrorResponse, jsonResponse, readJson } from "@/lib/api/http";
import { AppError } from "@/lib/errors";
import { authenticateRequest, enforceMutationChallenge } from "@/lib/security/auth";
import { getUploadStorage } from "@/lib/storage/uploads";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let principal;
  try {
    principal = authenticateRequest(request);
    await enforceMutationChallenge(request, principal);
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
    const response = await getUploadStorage().presign(parsed.data, {
      ownerId: principal.id,
      origin: new URL(request.url).origin
    });
    return jsonResponse(PresignUploadResponseSchema.parse(response), { status: 201, principal });
  } catch (error) {
    return apiErrorResponse(error, principal);
  }
}
