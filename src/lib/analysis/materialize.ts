import {
  AnalysisResultSchema,
  type AnalysisResult,
  type Citation,
  type CostEvent,
  type DocumentManifest
} from "@/contracts";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import { reconcileVersionedFacts } from "@/lib/analysis/reconciliation";
import {
  allCitationsVerified,
  verifyCitationBatch,
  type CitationDocument,
  type QuoteVerificationReceipt
} from "@/lib/evidence/citations";

export interface MaterializeInput {
  draft: DraftAnalysis;
  documents: Array<CitationDocument & { role: "base" | "amendment"; amendmentNumber: string | null }>;
  manifests: DocumentManifest[];
  costs: CostEvent[];
  generatedAt?: Date;
  expiresAt: Date;
}

export function materializeAnalysis(input: MaterializeInput): {
  result: AnalysisResult;
  receipts: QuoteVerificationReceipt[];
} {
  const generatedAt = input.generatedAt ?? new Date();
  const receipts: QuoteVerificationReceipt[] = [];
  let unsupportedItemsRemoved = 0;

  const verify = (draftCitations: DraftAnalysis["claims"][number]["citations"]): Citation[] => {
    const verified = verifyCitationBatch(
      draftCitations.map((citation) => ({
        documentSha256: citation.document_sha256,
        chunkId: citation.chunk_id,
        evidenceQuote: citation.evidence_quote,
        section: citation.section
      })),
      input.documents,
      generatedAt
    );
    receipts.push(...verified.receipts);
    return verified.citations.filter((citation) => citation.verified);
  };

  const claimDrafts = input.draft.claims.flatMap((claim) => {
    const citations = verify(claim.citations);
    if (claim.claim_type !== "unknown" && !allCitationsVerified(citations)) {
      unsupportedItemsRemoved += 1;
      return [];
    }
    const document = input.documents.find(
      (item) => item.index.documentSha256 === claim.document_sha256
    );
    return [{ claim, citations, document }];
  });

  const reconciliation = reconcileVersionedFacts(
    claimDrafts.map(({ claim, citations, document }) => ({
      id: claim.claim_id,
      topic: claim.topic,
      value: claim.claim_text,
      documentSha256: claim.document_sha256,
      documentRole: document?.role ?? "base",
      amendmentNumber: claim.amendment_number ?? document?.amendmentNumber ?? null,
      effect: claim.effect,
      citations,
      supersedesIds: claim.supersedes_claim_ids
    }))
  );

  const claims = reconciliation.facts.map((fact) => {
    const draft = claimDrafts.find((item) => item.claim.claim_id === fact.id)?.claim;
    return {
      claim_id: fact.id,
      claim_text: fact.value,
      claim_type: draft?.claim_type ?? (fact.status === "conflicted" ? "conflict" as const : "source" as const),
      status: fact.status,
      confidence: draft?.confidence ?? 1,
      citations: fact.citations,
      formula_and_inputs: null
    };
  });

  const requirements = input.draft.requirements.flatMap((requirement) => {
    const citations = verify(requirement.citations);
    if (!allCitationsVerified(citations)) {
      unsupportedItemsRemoved += 1;
      return [];
    }
    const fact = reconciliation.facts.find((item) => item.id === requirement.id);
    return [{
      id: requirement.id,
      category: requirement.category,
      status: fact?.status ?? "active" as const,
      text: requirement.text,
      evidence_needed: requirement.evidence_needed,
      consequence: requirement.consequence,
      citations
    }];
  });

  const risks = input.draft.risks.flatMap((risk) => {
    const citations = verify(risk.citations);
    if (!allCitationsVerified(citations)) {
      unsupportedItemsRemoved += 1;
      return [];
    }
    return [{
      id: risk.id,
      severity: risk.severity,
      category: risk.category,
      finding: risk.finding,
      impact: risk.impact,
      recommended_action: risk.recommended_action,
      citations
    }];
  });

  const evaluationCitations = verify(input.draft.evaluation.citations);
  const evaluationSupported = allCitationsVerified(evaluationCitations);
  if (!evaluationSupported && input.draft.evaluation.citations.length > 0) unsupportedItemsRemoved += 1;

  const conflicts = reconciliation.conflicts.filter((conflict) => {
    const supported = conflict.citations.length >= 2 && conflict.citations.every((citation) => citation.verified);
    if (!supported) unsupportedItemsRemoved += 1;
    return supported;
  });

  const allVisibleCitations = [
    ...claims.flatMap((claim) => claim.citations),
    ...requirements.flatMap((requirement) => requirement.citations),
    ...risks.flatMap((risk) => risk.citations),
    ...conflicts.flatMap((conflict) => conflict.citations),
    ...evaluationCitations
  ];
  const coveredPages = new Set(
    allVisibleCitations
      .filter((citation) => citation.verified && citation.pdf_page_1based !== null)
      .map((citation) => `${citation.document_sha256}:${citation.pdf_page_1based}`)
  );
  const criticalClaims = requirements.length + risks.filter((risk) => risk.severity !== "low").length +
    conflicts.length + (evaluationSupported ? 1 : 0);
  const actualMicroUsd = input.costs.reduce((total, event) => total + (event.actual_micro_usd ?? 0), 0);
  const estimatedMicroUsd = input.costs.reduce(
    (total, event) => total + (event.actual_micro_usd === null ? event.estimated_micro_usd ?? 0 : 0),
    0
  );
  const blockingUnknowns = [...input.draft.blocking_unknowns];
  if (conflicts.length > 0 && !blockingUnknowns.includes("The package contains unresolved amendment conflicts.")) {
    blockingUnknowns.push("The package contains unresolved amendment conflicts.");
  }

  const result: AnalysisResult = {
    schema_version: "1.0",
    source_scope: "document_only",
    package_completeness: input.manifests.every((manifest) => manifest.cleanup_status === "deleted")
      ? "verified"
      : "unverified",
    document_manifest: input.manifests,
    summary: input.draft.summary,
    claims,
    requirements,
    evaluation: {
      mandatory_gate: evaluationSupported ? input.draft.evaluation.mandatory_gate : null,
      rated_threshold: evaluationSupported ? input.draft.evaluation.rated_threshold : null,
      technical_weight: evaluationSupported ? input.draft.evaluation.technical_weight : null,
      financial_weight: evaluationSupported ? input.draft.evaluation.financial_weight : null,
      selection_method: evaluationSupported ? input.draft.evaluation.selection_method : null,
      citations: evaluationCitations
    },
    risks,
    conflicts,
    clarification_questions: input.draft.clarification_questions,
    decision_readiness:
      blockingUnknowns.length > 0 || conflicts.length > 0
        ? "needs_clarification"
        : "ready_for_bidder_assessment",
    blocking_unknowns: blockingUnknowns,
    quality: {
      pages_total: input.manifests.reduce((total, manifest) => total + manifest.pages, 0),
      pages_covered: coveredPages.size,
      critical_claims: criticalClaims,
      critical_claims_cited: criticalClaims,
      citations_verified: allVisibleCitations.filter((citation) => citation.verified).length,
      unsupported_items_removed: unsupportedItemsRemoved,
      search_events: 0,
      follow_embedded_link_events: 0,
      warnings: [
        "Analysis is restricted to the supplied documents.",
        "Provider-side Monid run and artifact retention is unknown."
      ]
    },
    costs: {
      currency: "USD",
      events: input.costs,
      actual_micro_usd: actualMicroUsd,
      estimated_micro_usd: estimatedMicroUsd,
      total_micro_usd: actualMicroUsd + estimatedMicroUsd,
      includes_failed_attempts: input.costs.some((event) => event.status === "failed")
    },
    generated_at: generatedAt.toISOString(),
    expires_at: input.expiresAt.toISOString()
  };
  return { result: AnalysisResultSchema.parse(result), receipts };
}
