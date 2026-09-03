import { z } from "zod";
import { AnalysisResultSchema, ErrorCodeSchema, RunStatusSchema } from "./analysis";

const RoleSchema = z.enum(["base", "amendment"]);

export const UrlSourceSchema = z.object({
  type: z.literal("url"),
  url: z.url({ protocol: /^https$/ })
});

export const UploadSourceSchema = z.object({
  type: z.literal("upload"),
  blob_path: z.string().min(1).max(512),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size_bytes: z.number().int().positive().max(25 * 1024 * 1024),
  filename: z.string().min(1).max(200)
});

export const RunDocumentInputSchema = z.object({
  role: RoleSchema,
  source: z.discriminatedUnion("type", [UrlSourceSchema, UploadSourceSchema])
});

export const CreateRunRequestSchema = z.object({
  documents: z.array(RunDocumentInputSchema).min(1).max(5)
}).superRefine((value, context) => {
  const baseCount = value.documents.filter((document) => document.role === "base").length;
  if (baseCount !== 1) {
    context.addIssue({
      code: "custom",
      path: ["documents"],
      message: "Exactly one base document is required."
    });
  }
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const CreateRunResponseSchema = z.object({
  run_id: z.uuid(),
  status: RunStatusSchema,
  status_url: z.string().startsWith("/api/v1/runs/")
});
export type CreateRunResponse = z.infer<typeof CreateRunResponseSchema>;

export const PresignUploadRequestSchema = z.object({
  filename: z.string().min(1).max(200).refine((name) => name.toLowerCase().endsWith(".pdf"), "A PDF filename is required."),
  size_bytes: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
});
export type PresignUploadRequest = z.infer<typeof PresignUploadRequestSchema>;

export const PresignUploadResponseSchema = z.object({
  blob_path: z.string(),
  upload_url: z.url(),
  expires_at: z.iso.datetime(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string())
});
export type PresignUploadResponse = z.infer<typeof PresignUploadResponseSchema>;

export const RunStatusResponseSchema = z.object({
  run_id: z.uuid(),
  status: RunStatusSchema,
  stage: RunStatusSchema,
  progress: z.number().int().min(0).max(100),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  cleanup_confirmed: z.boolean(),
  cost_micro_usd: z.number().int().nonnegative(),
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    request_id: z.uuid()
  }).nullable()
});
export type RunStatusResponse = z.infer<typeof RunStatusResponseSchema>;

export const QuestionRequestSchema = z.object({
  question: z.string().trim().min(1).max(1000)
});

export const QuestionResponseSchema = z.object({
  answerability: z.enum(["answered", "partial", "not_found"]),
  answer: z.string(),
  citations: AnalysisResultSchema.shape.requirements.element.shape.citations,
  warning: z.string().nullable()
});
export type QuestionResponse = z.infer<typeof QuestionResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    request_id: z.uuid()
  })
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
