import { apiErrorResponse, noContentResponse } from "@/lib/api/http";
import { getLocalUploadStorage } from "@/lib/storage/uploads";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    await getLocalUploadStorage().acceptPut(token, request);
    return noContentResponse();
  } catch (error) {
    return apiErrorResponse(error);
  }
}
