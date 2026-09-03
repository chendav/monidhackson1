import { z } from "zod";

export const runStatuses = [
  "queued",
  "validating",
  "staging",
  "page_indexing",
  "parsing",
  "purging_source",
  "extracting",
  "reconciling",
  "verifying",
  "ready",
  "partial",
  "failed",
  "cleanup_pending",
  "expired"
] as const;

export const RunStatusSchema = z.enum(runStatuses);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const errorCodes = [
  "FILE_TOO_LARGE",
  "UNSUPPORTED_MEDIA",
  "ENCRYPTED_PDF",
  "UNSAFE_URL",
  "SOURCE_UNREACHABLE",
  "MONID_PARSE_FAILED",
  "EMPTY_PARSE",
  "MODEL_UNAVAILABLE",
  "ANALYSIS_INCOMPLETE",
  "SOURCE_CLEANUP_PENDING",
  "BUDGET_EXCEEDED",
  "RATE_LIMITED"
] as const;

export const ErrorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const CitationSchema = z.object({
  document_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  document_name: z.string().min(1),
  source_url: z.url().nullable(),
  pdf_page_1based: z.number().int().positive().nullable(),
  printed_page_label: z.string().nullable(),
  section: z.string().nullable(),
  evidence_quote: z.string().min(1).max(500),
  verified: z.boolean(),
  verification_method: z.enum(["exact", "normalized", "manual_required"])
});
export type Citation = z.infer<typeof CitationSchema>;

export const ClaimSchema = z.object({
  claim_id: z.string().min(1),
  claim_text: z.string().min(1),
  claim_type: z.enum(["source", "user_input", "derived", "unknown", "conflict"]),
  status: z.enum(["active", "superseded", "conflicted", "needs_review"]),
  confidence: z.number().min(0).max(1),
  citations: z.array(CitationSchema),
  formula_and_inputs: z
    .object({
      formula: z.string(),
      inputs: z.record(z.string(), z.union([z.string(), z.number(), z.null()]))
    })
    .nullable()
});
export type Claim = z.infer<typeof ClaimSchema>;

export const DocumentManifestSchema = z.object({
  document_id: z.uuid(),
  role: z.enum(["base", "amendment"]),
  source_type: z.enum(["url", "upload"]),
  source_name: z.string().min(1),
  source_url: z.url().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.number().int().positive(),
  language: z.string().min(2),
  solicitation_number: z.string().nullable(),
  amendment_number: z.string().nullable(),
  status: z.enum(["active", "superseded"]),
  cleanup_status: z.enum(["pending", "deleted", "failed"])
});
export type DocumentManifest = z.infer<typeof DocumentManifestSchema>;

export const RequirementSchema = z.object({
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
  status: z.enum(["active", "superseded", "conflicted", "needs_review"]),
  text: z.string().min(1),
  evidence_needed: z.string().nullable(),
  consequence: z.string().nullable(),
  citations: z.array(CitationSchema).min(1)
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const RiskSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  category: z.string().min(1),
  finding: z.string().min(1),
  impact: z.string().min(1),
  recommended_action: z.string().min(1),
  citations: z.array(CitationSchema).min(1)
});
export type Risk = z.infer<typeof RiskSchema>;

export const ConflictSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  status: z.literal("conflicted"),
  candidate_values: z.array(z.string()).min(2),
  safe_answer: z.string().min(1),
  citations: z.array(CitationSchema).min(2)
});
export type Conflict = z.infer<typeof ConflictSchema>;

export const MonidCostProvenanceSchema = z.strictObject({
  kind: z.literal("credentialed_inspect"),
  inspect_schema_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  value_path: z.string().min(1),
  currency_path: z.string().min(1),
  value_unit: z.enum(["currency_major", "micro_dollar"]),
  source_value: z.union([z.number().nonnegative(), z.string().regex(/^\d+(?:\.\d{1,6})?$/)]),
  source_currency: z.literal("USD")
});
export type MonidCostProvenance = z.infer<typeof MonidCostProvenanceSchema>;

export const CostProviderSchema = z.enum([
  "monid",
  "openai",
  "railway_s3",
  "vercel_blob",
  "vercel",
  "neon"
]);

export const CostEventSchema = z.object({
  attempt_id: z.string().uuid().nullable().optional(),
  provider: CostProviderSchema,
  operation: z.string().min(1),
  status: z.enum(["pending", "succeeded", "failed"]),
  actual_micro_usd: z.number().int().nonnegative().nullable(),
  estimated_micro_usd: z.number().int().nonnegative().nullable(),
  latency_ms: z.number().int().nonnegative(),
  retry_of: z.string().nullable(),
  cost_provenance: MonidCostProvenanceSchema.nullable().optional(),
  estimation_basis: z.string().min(1).max(1_000).nullable().optional(),
  pricing_source_url: z.url().nullable().optional(),
  pricing_observed_at: z.iso.datetime().nullable().optional()
});
export type CostEvent = z.infer<typeof CostEventSchema>;

export const AnalysisResultSchema = z.object({
  schema_version: z.literal("1.0"),
  source_scope: z.literal("document_only"),
  package_completeness: z.enum(["verified", "unverified", "incomplete"]),
  document_manifest: z.array(DocumentManifestSchema).min(1),
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
  claims: z.array(ClaimSchema),
  requirements: z.array(RequirementSchema),
  evaluation: z.object({
    mandatory_gate: z.boolean().nullable(),
    rated_threshold: z.string().nullable(),
    technical_weight: z.number().min(0).max(100).nullable(),
    financial_weight: z.number().min(0).max(100).nullable(),
    selection_method: z.string().nullable(),
    citations: z.array(CitationSchema)
  }),
  risks: z.array(RiskSchema),
  conflicts: z.array(ConflictSchema),
  clarification_questions: z.array(z.string()),
  decision_readiness: z.enum(["ready_for_bidder_assessment", "needs_clarification", "incomplete"]),
  blocking_unknowns: z.array(z.string()),
  quality: z.object({
    pages_total: z.number().int().nonnegative(),
    pages_covered: z.number().int().nonnegative(),
    critical_claims: z.number().int().nonnegative(),
    critical_claims_cited: z.number().int().nonnegative(),
    citations_verified: z.number().int().nonnegative(),
    unsupported_items_removed: z.number().int().nonnegative(),
    search_events: z.literal(0),
    follow_embedded_link_events: z.literal(0),
    warnings: z.array(z.string())
  }),
  costs: z.object({
    currency: z.literal("USD"),
    events: z.array(CostEventSchema),
    completeness: z.enum(["complete", "partial"]),
    unpriced_providers: z.array(CostProviderSchema),
    not_applicable_providers: z.array(CostProviderSchema),
    actual_micro_usd: z.number().int().nonnegative(),
    estimated_micro_usd: z.number().int().nonnegative(),
    known_subtotal_micro_usd: z.number().int().nonnegative(),
    total_micro_usd: z.number().int().nonnegative(),
    includes_failed_attempts: z.boolean()
  }),
  generated_at: z.iso.datetime(),
  expires_at: z.iso.datetime()
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
