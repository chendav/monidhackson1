import { z } from "zod";
import {
  CitationSchema,
  ErrorCodeSchema,
  RunStatusSchema
} from "./analysis";

const RoleSchema = z.enum(["base", "amendment"]);

export const UrlSourceSchema = z.strictObject({
  type: z.literal("url"),
  url: z.url({ protocol: /^https$/ })
});

export const UploadSourceSchema = z.strictObject({
  type: z.literal("upload"),
  blob_path: z.string().min(1).max(512),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size_bytes: z.number().int().positive().max(25 * 1024 * 1024),
  filename: z.string().min(1).max(200)
});

export const RunDocumentInputSchema = z.strictObject({
  role: RoleSchema,
  source: z.discriminatedUnion("type", [UrlSourceSchema, UploadSourceSchema])
});

export const CreateRunRequestSchema = z.strictObject({
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

export const CreateRunResponseSchema = z.strictObject({
  run_id: z.uuid(),
  status: RunStatusSchema,
  status_url: z.string().startsWith("/api/v1/runs/")
});
export type CreateRunResponse = z.infer<typeof CreateRunResponseSchema>;

export const PresignUploadRequestSchema = z.strictObject({
  filename: z.string().min(1).max(200).refine((name) => name.toLowerCase().endsWith(".pdf"), "A PDF filename is required."),
  size_bytes: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
});
export type PresignUploadRequest = z.infer<typeof PresignUploadRequestSchema>;

export const PresignUploadResponseSchema = z.strictObject({
  blob_path: z.string().min(1).max(512),
  upload_url: z.url(),
  expires_at: z.iso.datetime(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string())
});
export type PresignUploadResponse = z.infer<typeof PresignUploadResponseSchema>;

export const RunStatusResponseSchema = z.strictObject({
  run_id: z.uuid(),
  status: RunStatusSchema,
  stage: RunStatusSchema,
  progress: z.number().int().min(0).max(100),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  cleanup_confirmed: z.boolean(),
  cost_micro_usd: z.number().int().nonnegative(),
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    request_id: z.uuid()
  }).nullable()
});
export type RunStatusResponse = z.infer<typeof RunStatusResponseSchema>;

export const QuestionRequestSchema = z.strictObject({
  question: z.string().trim().min(1).max(1000)
});
export type QuestionRequest = z.infer<typeof QuestionRequestSchema>;

const QuestionResponseBase = {
  answer: z.string().min(1),
  warning: z.string().nullable()
} as const;

/**
 * `answered` is the only answerability level that promises a supported answer,
 * so it must carry at least one citation. A partial result may be useful even
 * when no exact quote survived verification, while `not_found` deliberately
 * carries no citations.
 */
export const QuestionResponseSchema = z.discriminatedUnion("answerability", [
  z.strictObject({
    answerability: z.literal("answered"),
    ...QuestionResponseBase,
    citations: z.array(CitationSchema).min(1)
  }),
  z.strictObject({
    answerability: z.literal("partial"),
    ...QuestionResponseBase,
    citations: z.array(CitationSchema)
  }),
  z.strictObject({
    answerability: z.literal("not_found"),
    ...QuestionResponseBase,
    citations: z.array(CitationSchema).max(0)
  })
]);
export type QuestionResponse = z.infer<typeof QuestionResponseSchema>;

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    request_id: z.uuid()
  })
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthResponseSchema = z.strictObject({
  status: z.enum(["ok", "degraded", "not_ready"]),
  version: z.literal("1.0"),
  mode: z.enum(["live", "local_fallback", "unavailable"]),
  dependencies: z.strictObject({
    database: z.enum(["configured", "missing", "memory_fallback"]),
    private_blob: z.enum(["configured", "missing", "memory_fallback"]),
    workflow: z.enum(["configured", "missing", "microtask_fallback"]),
    monid: z.enum(["configured", "missing", "local_fallback"]),
    openai: z.enum(["configured", "missing", "local_fallback"])
  }),
  missing: z.array(z.string()),
  source_scope: z.literal("document_only"),
  provider_retention: z.literal("unknown")
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
