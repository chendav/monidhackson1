import { QuestionRequestSchema, QuestionResponseSchema } from "@/contracts";
import { answerFromPersistedEvidence } from "@/lib/analysis/closed-world";
import { apiErrorResponse, getOwnedRun, jsonResponse, readJson } from "@/lib/api/http";
import { sha256Hex } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { auditLog } from "@/lib/logging";
import { getQuestionAuditStore } from "@/lib/questions/audit-store";
import { getRunStore } from "@/lib/runs/store";
import { authenticateRequest, enforceMutationChallenge } from "@/lib/security/auth";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  let principal;
  try {
    principal = authenticateRequest(request);
    await enforceMutationChallenge(request, principal);
    const parsed = QuestionRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new AppError("ANALYSIS_INCOMPLETE", parsed.error.issues.map((issue) => issue.message).join(" "), {
        httpStatus: 422
      });
    }
    const store = await getRunStore();
    const record = await getOwnedRun(store, (await context.params).runId, principal);
    if (!record.result || !["ready", "partial"].includes(record.status)) {
      throw new AppError("ANALYSIS_INCOMPLETE", "Questions are available after analysis completes.", {
        httpStatus: 409,
        retryable: !["failed", "expired"].includes(record.status)
      });
    }
    const response = QuestionResponseSchema.parse(
      answerFromPersistedEvidence(parsed.data.question, record.result)
    );
    const questionSha256 = sha256Hex(parsed.data.question);
    await getQuestionAuditStore().record({
      runId: record.id,
      questionSha256,
      answerability: response.answerability,
      citationCount: response.citations.length
    });
    auditLog("question_answered", {
      run_id: record.id,
      question_sha256: questionSha256,
      answerability: response.answerability,
      citation_count: response.citations.length
    });
    return jsonResponse(response, { principal });
  } catch (error) {
    return apiErrorResponse(error, principal);
  }
}
