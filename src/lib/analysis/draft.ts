import { z } from "zod";

export const DraftCitationSchema = z.object({
  document_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  chunk_id: z.string().min(1).max(300).nullable(),
  evidence_quote: z.string().min(1).max(500),
  section: z.string().max(500).nullable()
});

export const DraftSourceRefSchema = z.object({
  topic: z.string().min(1).max(300),
  document_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  amendment_number: z.string().nullable(),
  effect: z.enum(["add", "replace", "delete"])
});

export const DraftEvaluationRuleSchema = DraftSourceRefSchema.extend({
  id: z.string().min(1).max(200),
  field: z.enum([
    "mandatory_gate",
    "rated_threshold",
    "technical_weight",
    "financial_weight",
    "selection_method"
  ]),
  // A single scalar representation keeps the versioning contract uniform.
  // Materialization performs field-specific parsing and evidence validation.
  value: z.string().min(1).max(1_000),
  citations: z.array(DraftCitationSchema).min(1).max(20)
});

export const DraftClaimSchema = DraftSourceRefSchema.extend({
  claim_id: z.string().min(1).max(200),
  claim_text: z.string().min(1).max(2_000),
  claim_type: z.enum(["source", "derived", "unknown"]),
  confidence: z.number().min(0).max(1),
  citations: z.array(DraftCitationSchema).max(20),
  supersedes_claim_ids: z.array(z.string().max(200)).max(100)
});

export const DraftRequirementSchema = DraftSourceRefSchema.extend({
  id: z.string().min(1).max(200),
  category: z.enum([
    "mandatory", "rated", "submission", "security", "financial", "contractual", "delivery"
  ]),
  text: z.string().min(1).max(2_000),
  evidence_needed: z.string().max(2_000).nullable(),
  consequence: z.string().max(2_000).nullable(),
  citations: z.array(DraftCitationSchema).min(1).max(20)
});

export const DraftRiskSchema = DraftSourceRefSchema.extend({
  id: z.string().min(1).max(200),
  severity: z.enum(["critical", "high", "medium", "low"]),
  category: z.string().min(1).max(300),
  finding: z.string().min(1).max(2_000),
  impact: z.string().min(1).max(2_000),
  recommended_action: z.string().min(1).max(2_000),
  citations: z.array(DraftCitationSchema).min(1).max(20)
});

export const DraftAnalysisSchema = z.object({
  summary: z.object({
    title: z.string().max(500),
    solicitation_number: z.string().max(200).nullable(),
    issuer: z.string().max(500).nullable(),
    closing_date: z.string().max(200).nullable(),
    overview: z.string().max(2_000),
    scope: z.array(z.string().max(500)).max(100),
    submission_method: z.string().max(1_000).nullable(),
    current_selection_method: z.string().max(1_000).nullable()
  }),
  claims: z.array(DraftClaimSchema).max(1_000),
  requirements: z.array(DraftRequirementSchema).max(1_000),
  evaluation: z.object({
    rules: z.array(DraftEvaluationRuleSchema).max(100)
  }),
  risks: z.array(DraftRiskSchema).max(500),
  clarification_questions: z.array(z.string().max(1_000)).max(100),
  blocking_unknowns: z.array(z.string().max(1_000)).max(100)
});

export type DraftAnalysis = z.infer<typeof DraftAnalysisSchema>;

export const DraftQuestionAnswerSchema = z.object({
  answerability: z.enum(["answered", "partial", "not_found"]),
  answer: z.string().max(4_000),
  citations: z.array(DraftCitationSchema).max(20),
  warning: z.string().max(1_000).nullable()
}).superRefine((value, context) => {
  if (value.answerability === "not_found" && value.citations.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["citations"],
      message: "not_found answers must have an empty citations array"
    });
  }
});
export type DraftQuestionAnswer = z.infer<typeof DraftQuestionAnswerSchema>;
