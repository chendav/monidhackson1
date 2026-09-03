import { z } from "zod";

export const DraftCitationSchema = z.object({
  document_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  chunk_id: z.string().min(1).nullable(),
  evidence_quote: z.string().min(1).max(500),
  section: z.string().nullable()
});

const DraftSourceRefSchema = z.object({
  topic: z.string().min(1),
  document_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  amendment_number: z.string().nullable(),
  effect: z.enum(["add", "replace", "delete"])
});

export const DraftAnalysisSchema = z.object({
  summary: z.object({
    title: z.string(),
    solicitation_number: z.string().nullable(),
    issuer: z.string().nullable(),
    closing_date: z.string().nullable(),
    overview: z.string(),
    scope: z.array(z.string()),
    submission_method: z.string().nullable(),
    current_selection_method: z.string().nullable()
  }),
  claims: z.array(
    DraftSourceRefSchema.extend({
      claim_id: z.string().min(1),
      claim_text: z.string().min(1),
      claim_type: z.enum(["source", "derived", "unknown"]),
      confidence: z.number().min(0).max(1),
      citations: z.array(DraftCitationSchema),
      supersedes_claim_ids: z.array(z.string())
    })
  ),
  requirements: z.array(
    DraftSourceRefSchema.extend({
      id: z.string().min(1),
      category: z.enum([
        "mandatory",
        "rated",
        "submission",
        "security",
        "financial",
        "contractual",
        "delivery"
      ]),
      text: z.string().min(1),
      evidence_needed: z.string().nullable(),
      consequence: z.string().nullable(),
      citations: z.array(DraftCitationSchema).min(1)
    })
  ),
  evaluation: z.object({
    mandatory_gate: z.boolean().nullable(),
    rated_threshold: z.string().nullable(),
    technical_weight: z.number().min(0).max(100).nullable(),
    financial_weight: z.number().min(0).max(100).nullable(),
    selection_method: z.string().nullable(),
    citations: z.array(DraftCitationSchema)
  }),
  risks: z.array(
    z.object({
      id: z.string().min(1),
      severity: z.enum(["critical", "high", "medium", "low"]),
      category: z.string().min(1),
      finding: z.string().min(1),
      impact: z.string().min(1),
      recommended_action: z.string().min(1),
      citations: z.array(DraftCitationSchema).min(1)
    })
  ),
  clarification_questions: z.array(z.string()),
  blocking_unknowns: z.array(z.string())
});

export type DraftAnalysis = z.infer<typeof DraftAnalysisSchema>;

export const DraftQuestionAnswerSchema = z.object({
  answerability: z.enum(["answered", "partial", "not_found"]),
  answer: z.string(),
  citations: z.array(DraftCitationSchema),
  warning: z.string().nullable()
});
export type DraftQuestionAnswer = z.infer<typeof DraftQuestionAnswerSchema>;
