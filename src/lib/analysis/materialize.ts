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
  assertionTokensSupportedByCitations,
  citationsMatchDocument,
  verifyCitationBatch,
  type CitationDocument,
  type QuoteVerificationReceipt
} from "@/lib/evidence/citations";
import { normalizeEvidenceText } from "@/lib/pdf/page-index";

export interface MaterializeInput {
  draft: DraftAnalysis;
  documents: Array<CitationDocument & { role: "base" | "amendment"; amendmentNumber: string | null }>;
  manifests: DocumentManifest[];
  costs: CostEvent[];
  generatedAt?: Date;
  expiresAt: Date;
}

type EvaluationField = DraftAnalysis["evaluation"]["rules"][number]["field"];

function deduplicateCitations(citations: Citation[]) {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.document_sha256}:${citation.pdf_page_1based}:${citation.evidence_quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function significantWords(value: string) {
  const ignored = new Set(["a", "an", "and", "for", "in", "of", "on", "the", "to", "with"]);
  return [...new Set(normalizeEvidenceText(value).match(/[a-z]{3,}/g)?.filter((word) => !ignored.has(word)) ?? [])];
}

function evaluationCitationIsRelevant(field: EvaluationField, citation: Citation) {
  const quote = normalizeEvidenceText(citation.evidence_quote);
  switch (field) {
    case "mandatory_gate":
      return /\bmandatory\b/.test(quote) && /\b(fail|failed|fails|non-compliant|noncompliant|must|required|responsive)\b/.test(quote);
    case "rated_threshold":
      return /\b(minimum|threshold|points?|rating|score|rated)\b/.test(quote);
    case "technical_weight":
      return /\btechnical\b/.test(quote) && /(%|percent|ratio|weight)/.test(quote);
    case "financial_weight":
      return /\b(financial|price)\b/.test(quote) && /(%|percent|ratio|weight)/.test(quote);
    case "selection_method":
      return /\b(award|selection|select|selected|rating|lowest|highest)\b/.test(quote);
  }
}

function validatedEvaluationRule(
  field: EvaluationField,
  value: string,
  citations: Citation[]
): Citation[] | null {
  const relevant = citations.filter((citation) => evaluationCitationIsRelevant(field, citation));
  if (!allCitationsVerified(relevant) || !assertionTokensSupportedByCitations(value, relevant)) return null;
  const normalizedValue = normalizeEvidenceText(value);
  const combinedEvidence = normalizeEvidenceText(relevant.map((citation) => citation.evidence_quote).join(" "));
  if (field === "mandatory_gate") {
    if (normalizedValue === "true") return relevant;
    if (normalizedValue === "false" && /\b(no|not|without)\b.{0,40}\bmandatory\b/.test(combinedEvidence)) {
      return relevant;
    }
    return null;
  }
  if (field === "technical_weight" || field === "financial_weight") {
    const parsed = Number(value.replace(/%/g, "").trim());
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? relevant : null;
  }
  if (field === "rated_threshold") {
    return /\b(minimum|threshold|points?|rating|score|rated)\b/.test(combinedEvidence) ? relevant : null;
  }
  const words = significantWords(value);
  const supportedWords = words.filter((word) => combinedEvidence.includes(word)).length;
  return words.length > 0 && supportedWords / words.length >= 0.6 ? relevant : null;
}

function parseEvaluationValue(field: EvaluationField, value: string): boolean | number | string | null {
  if (field === "mandatory_gate") {
    const normalized = normalizeEvidenceText(value);
    return normalized === "true" ? true : normalized === "false" ? false : null;
  }
  if (field === "technical_weight" || field === "financial_weight") {
    const parsed = Number(value.replace(/%/g, "").trim());
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
  }
  return value.trim() || null;
}

const SUMMARY_TOPIC_PATTERNS = {
  title: /\b(title|tender name|rfp name|solicitation name)\b/i,
  solicitation_number: /\b(solicitation|tender|rfp|reference)\b.*\b(number|no|id)\b/i,
  issuer: /\b(issuer|buyer|contracting authority|department|agency)\b/i,
  closing_date: /\b(closing|deadline|due date|submission date)\b/i,
  overview: /\b(overview|summary|project description|scope)\b/i,
  scope: /\b(scope|deliverable|service|statement of work|work requirement)\b/i,
  submission_method: /\b(submission|submit)\b.*\b(method|portal|email|electronic|instructions?)\b/i,
  current_selection_method: /\b(selection|award)\b.*\b(method|basis|rating|price)\b/i
} as const;

export function materializeAnalysis(input: MaterializeInput): {
  result: AnalysisResult;
  receipts: QuoteVerificationReceipt[];
} {
  const generatedAt = input.generatedAt ?? new Date();
  const receipts: QuoteVerificationReceipt[] = [];
  let unsupportedItemsRemoved = 0;
  let truthReviewItems = 0;

  const verify = (
    draftCitations: DraftAnalysis["claims"][number]["citations"]
  ): { citations: Citation[]; everyCandidateVerified: boolean } => {
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
    return {
      citations: verified.citations.filter((citation) => citation.verified),
      everyCandidateVerified: verified.citations.length > 0 && verified.citations.every(
        (citation) => citation.verified && citation.pdf_page_1based !== null
      )
    };
  };

  const validClaimDrafts: Array<{
    claim: DraftAnalysis["claims"][number]; citations: Citation[];
    document: MaterializeInput["documents"][number];
  }> = [];
  const reviewClaims: AnalysisResult["claims"] = [];
  let unknownClaimCount = 0;
  for (const claim of input.draft.claims) {
    const checked = verify(claim.citations);
    const matchingCitations = checked.citations.filter(
      (citation) => citation.document_sha256 === claim.document_sha256
    );
    if (claim.claim_type === "unknown") {
      unknownClaimCount += 1;
      truthReviewItems += 1;
      reviewClaims.push({
        claim_id: claim.claim_id,
        claim_text: claim.claim_text,
        claim_type: "unknown",
        status: "needs_review",
        confidence: claim.confidence,
        citations: matchingCitations,
        formula_and_inputs: null
      });
      continue;
    }
    const document = input.documents.find((item) => item.index.documentSha256 === claim.document_sha256);
    const sourceConsistent = Boolean(document && checked.everyCandidateVerified &&
      citationsMatchDocument(checked.citations, claim.document_sha256));
    const scalarSupported = assertionTokensSupportedByCitations(claim.claim_text, matchingCitations);
    if (!sourceConsistent || !scalarSupported) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      if (claim.effect !== "delete") {
        reviewClaims.push({
          claim_id: claim.claim_id,
          claim_text: claim.claim_text,
          claim_type: claim.claim_type,
          status: "needs_review",
          confidence: claim.confidence,
          citations: matchingCitations,
          formula_and_inputs: null
        });
      }
      continue;
    }
    validClaimDrafts.push({ claim, citations: checked.citations, document: document! });
  }

  const claimReconciliation = reconcileVersionedFacts(validClaimDrafts.map(({ claim, citations, document }) => ({
    id: claim.claim_id,
    topic: claim.topic,
    value: claim.claim_text,
    documentSha256: claim.document_sha256,
    documentRole: document.role,
    amendmentNumber: document.amendmentNumber,
    effect: claim.effect,
    citations,
    supersedesIds: claim.supersedes_claim_ids
  })));
  const claims: AnalysisResult["claims"] = [
    ...claimReconciliation.facts.flatMap((fact) => {
      const draft = validClaimDrafts.find((item) => item.claim.claim_id === fact.id)?.claim;
      if (!draft || draft.effect === "delete") return [];
      return [{
        claim_id: fact.id,
        claim_text: fact.value,
        claim_type: fact.status === "conflicted" ? "conflict" as const : draft.claim_type,
        status: fact.status,
        confidence: draft.confidence,
        citations: fact.citations,
        formula_and_inputs: null
      }];
    }),
    ...reviewClaims
  ];

  const validRequirementDrafts: Array<{
    requirement: DraftAnalysis["requirements"][number]; citations: Citation[];
    document: MaterializeInput["documents"][number];
  }> = [];
  const reviewRequirements: AnalysisResult["requirements"] = [];
  for (const requirement of input.draft.requirements) {
    const checked = verify(requirement.citations);
    const matchingCitations = checked.citations.filter(
      (citation) => citation.document_sha256 === requirement.document_sha256
    );
    const document = input.documents.find(
      (item) => item.index.documentSha256 === requirement.document_sha256
    );
    const supported = Boolean(document && checked.everyCandidateVerified &&
      citationsMatchDocument(checked.citations, requirement.document_sha256) &&
      assertionTokensSupportedByCitations(requirement.text, matchingCitations));
    if (!supported) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      if (requirement.effect !== "delete" && matchingCitations.length > 0) {
        reviewRequirements.push({
          id: requirement.id,
          category: requirement.category,
          status: "needs_review",
          text: requirement.text,
          evidence_needed: null,
          consequence: null,
          citations: matchingCitations
        });
      }
      continue;
    }
    validRequirementDrafts.push({ requirement, citations: checked.citations, document: document! });
  }
  const requirementReconciliation = reconcileVersionedFacts(validRequirementDrafts.map(
    ({ requirement, citations, document }) => ({
      id: requirement.id,
      topic: requirement.topic,
      value: requirement.text,
      documentSha256: requirement.document_sha256,
      documentRole: document.role,
      amendmentNumber: document.amendmentNumber,
      effect: requirement.effect,
      citations
    })
  ));
  const requirements: AnalysisResult["requirements"] = [
    ...requirementReconciliation.facts.flatMap((fact) => {
      const draft = validRequirementDrafts.find((item) => item.requirement.id === fact.id)?.requirement;
      if (!draft || draft.effect === "delete") return [];
      return [{
        id: draft.id,
        category: draft.category,
        status: fact.status,
        text: fact.value,
        evidence_needed: draft.evidence_needed && assertionTokensSupportedByCitations(draft.evidence_needed, fact.citations)
          ? draft.evidence_needed : null,
        consequence: draft.consequence && assertionTokensSupportedByCitations(draft.consequence, fact.citations)
          ? draft.consequence : null,
        citations: fact.citations
      }];
    }),
    ...reviewRequirements
  ];

  const validEvaluationRules: Array<{
    rule: DraftAnalysis["evaluation"]["rules"][number]; citations: Citation[];
    document: MaterializeInput["documents"][number];
  }> = [];
  for (const rule of input.draft.evaluation.rules) {
    const checked = verify(rule.citations);
    const document = input.documents.find((item) => item.index.documentSha256 === rule.document_sha256);
    const sourceConsistent = Boolean(document && checked.everyCandidateVerified &&
      citationsMatchDocument(checked.citations, rule.document_sha256));
    const supportedCitations = sourceConsistent
      ? validatedEvaluationRule(rule.field, rule.value, checked.citations)
      : null;
    if (!supportedCitations) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      continue;
    }
    validEvaluationRules.push({ rule, citations: supportedCitations, document: document! });
  }
  const evaluationReconciliation = reconcileVersionedFacts(validEvaluationRules.map(
    ({ rule, citations, document }) => ({
      id: rule.id,
      topic: rule.topic,
      factKey: `evaluation:${rule.field}`,
      value: rule.value,
      documentSha256: rule.document_sha256,
      documentRole: document.role,
      amendmentNumber: document.amendmentNumber,
      effect: rule.effect,
      citations
    })
  ));
  const evaluationValues: {
    mandatory_gate: boolean | null;
    rated_threshold: string | null;
    technical_weight: number | null;
    financial_weight: number | null;
    selection_method: string | null;
  } = {
    mandatory_gate: null,
    rated_threshold: null,
    technical_weight: null,
    financial_weight: null,
    selection_method: null
  };
  const evaluationCitations: Citation[] = [];
  for (const field of Object.keys(evaluationValues) as EvaluationField[]) {
    const active = evaluationReconciliation.facts.filter(
      (fact) => fact.factKey === `evaluation:${field}` && fact.status === "active"
    );
    const values = new Set(active.map((fact) => normalizeEvidenceText(fact.value)));
    if (values.size !== 1 || active.length === 0) continue;
    const parsed = parseEvaluationValue(field, active[0].value);
    if (parsed === null) continue;
    if (field === "mandatory_gate") evaluationValues.mandatory_gate = parsed as boolean;
    else if (field === "technical_weight") evaluationValues.technical_weight = parsed as number;
    else if (field === "financial_weight") evaluationValues.financial_weight = parsed as number;
    else if (field === "rated_threshold") evaluationValues.rated_threshold = parsed as string;
    else evaluationValues.selection_method = parsed as string;
    evaluationCitations.push(...active.flatMap((fact) => fact.citations));
  }
  const uniqueEvaluationCitations = deduplicateCitations(evaluationCitations);

  const validRiskDrafts: Array<{
    risk: DraftAnalysis["risks"][number]; citations: Citation[];
    document: MaterializeInput["documents"][number];
  }> = [];
  for (const risk of input.draft.risks) {
    const checked = verify(risk.citations);
    const document = input.documents.find((item) => item.index.documentSha256 === risk.document_sha256);
    const supported = Boolean(document && checked.everyCandidateVerified &&
      citationsMatchDocument(checked.citations, risk.document_sha256) &&
      assertionTokensSupportedByCitations(
        `${risk.finding} ${risk.impact} ${risk.recommended_action}`,
        checked.citations
      ));
    if (!supported) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      continue;
    }
    validRiskDrafts.push({ risk, citations: checked.citations, document: document! });
  }
  const riskReconciliation = reconcileVersionedFacts(validRiskDrafts.map(({ risk, citations, document }) => ({
    id: risk.id,
    topic: risk.topic,
    value: risk.finding,
    documentSha256: risk.document_sha256,
    documentRole: document.role,
    amendmentNumber: document.amendmentNumber,
    effect: risk.effect,
    citations
  })));
  const risks: AnalysisResult["risks"] = riskReconciliation.facts.flatMap((fact) => {
    const draft = validRiskDrafts.find((item) => item.risk.id === fact.id)?.risk;
    if (!draft || draft.effect === "delete" || fact.status !== "active") return [];
    return [{
      id: draft.id,
      severity: draft.severity,
      category: draft.category,
      finding: draft.finding,
      impact: draft.impact,
      recommended_action: draft.recommended_action,
      citations: fact.citations
    }];
  });

  const conflicts = [
    ...claimReconciliation.conflicts,
    ...requirementReconciliation.conflicts,
    ...evaluationReconciliation.conflicts,
    ...riskReconciliation.conflicts
  ].filter((conflict) => {
    const supported = conflict.citations.length >= 2 && conflict.citations.every(
      (citation) => citation.verified && citation.pdf_page_1based !== null
    );
    if (!supported) unsupportedItemsRemoved += 1;
    return supported;
  });

  const blockingUnknowns = [...input.draft.blocking_unknowns];
  if (unknownClaimCount > 0) {
    blockingUnknowns.push("One or more extracted facts remain unknown and cannot replace source-backed facts.");
  }
  if (truthReviewItems > 0) {
    blockingUnknowns.push("One or more extracted items failed source, scalar, or field-specific evidence validation.");
  }
  if (conflicts.length > 0) {
    blockingUnknowns.push("The package contains unresolved amendment conflicts.");
  }

  const baseCount = input.manifests.filter((manifest) => manifest.role === "base").length;
  const amendments = input.manifests.filter((manifest) => manifest.role === "amendment");
  const missingSolicitationNumber = input.manifests.some((manifest) => !manifest.solicitation_number?.trim());
  const solicitationNumbers = new Set(input.manifests.map((manifest) =>
    normalizeEvidenceText(manifest.solicitation_number ?? "")
  ).filter(Boolean));
  const amendmentNumbers = amendments.flatMap((manifest) => {
    const match = manifest.amendment_number?.match(/^0*(\d+)$/);
    return match ? [Number.parseInt(match[1], 10)] : [];
  }).sort((left, right) => left - right);
  const amendmentSequenceIsComplete = amendments.length === 0 || (
    amendmentNumbers.length === amendments.length &&
    new Set(amendmentNumbers).size === amendmentNumbers.length &&
    amendmentNumbers.every((number, index) => number === index + 1)
  );
  const packageCompleteness: AnalysisResult["package_completeness"] =
    baseCount !== 1 || missingSolicitationNumber || amendments.some((manifest) => !manifest.amendment_number) ||
      solicitationNumbers.size !== 1 || !amendmentSequenceIsComplete
      ? "incomplete"
      : "unverified";
  blockingUnknowns.push(packageCompleteness === "incomplete"
    ? "The supplied package has incomplete or inconsistent server-derived document metadata."
    : "The supplied package completeness cannot be verified without an authoritative tender-notice manifest.");

  const activeClaimSources = claimReconciliation.facts.flatMap((fact) => {
    if (fact.status !== "active") return [];
    const draft = validClaimDrafts.find((item) => item.claim.claim_id === fact.id)?.claim;
    return draft ? [{ topic: draft.topic, value: fact.value }] : [];
  });
  const sourceSupportsSummary = (field: keyof typeof SUMMARY_TOPIC_PATTERNS, value: string | null) => {
    if (value === null) return false;
    const normalized = normalizeEvidenceText(value);
    if (field === "current_selection_method" && evaluationValues.selection_method &&
      normalizeEvidenceText(evaluationValues.selection_method) === normalized) return true;
    if (field === "scope" && requirements.some((requirement) =>
      requirement.status === "active" && normalizeEvidenceText(requirement.text) === normalized
    )) return true;
    return activeClaimSources.some((source) =>
      SUMMARY_TOPIC_PATTERNS[field].test(source.topic) && normalizeEvidenceText(source.value) === normalized
    );
  };
  const safeSummary = {
    title: sourceSupportsSummary("title", input.draft.summary.title)
      ? input.draft.summary.title : "Document-only RFP analysis",
    solicitation_number: sourceSupportsSummary("solicitation_number", input.draft.summary.solicitation_number)
      ? input.draft.summary.solicitation_number : null,
    issuer: sourceSupportsSummary("issuer", input.draft.summary.issuer) ? input.draft.summary.issuer : null,
    closing_date: sourceSupportsSummary("closing_date", input.draft.summary.closing_date)
      ? input.draft.summary.closing_date : null,
    overview: sourceSupportsSummary("overview", input.draft.summary.overview)
      ? input.draft.summary.overview
      : "Only server-verified, cited facts from the supplied documents are included below.",
    scope: input.draft.summary.scope.filter((item) => sourceSupportsSummary("scope", item)),
    submission_method: sourceSupportsSummary("submission_method", input.draft.summary.submission_method)
      ? input.draft.summary.submission_method : null,
    current_selection_method: sourceSupportsSummary(
      "current_selection_method",
      input.draft.summary.current_selection_method
    ) ? input.draft.summary.current_selection_method : null
  };

  const activeRequirements = requirements.filter((requirement) => requirement.status === "active");
  const evaluationFieldsSupported = Object.values(evaluationValues).filter((value) => value !== null).length;
  const minimumCoverage = activeRequirements.length > 0 && evaluationFieldsSupported > 0;
  const hasAnySubstantiveEvidence = claims.some((claim) =>
    claim.status === "active" && claim.claim_type !== "unknown"
  ) || activeRequirements.length > 0 || risks.length > 0 || conflicts.length > 0 || evaluationFieldsSupported > 0;
  if (!hasAnySubstantiveEvidence) {
    blockingUnknowns.push("No substantive source-backed analysis could be verified.");
  }
  if (activeRequirements.length === 0) {
    blockingUnknowns.push("No current source-backed requirement coverage could be verified.");
  }
  if (evaluationFieldsSupported === 0) {
    blockingUnknowns.push("No independently source-backed evaluation rule could be verified.");
  }
  const uniqueBlockingUnknowns = [...new Set(blockingUnknowns)];

  const allVisibleCitations = [
    ...claims.flatMap((claim) => claim.citations),
    ...requirements.flatMap((requirement) => requirement.citations),
    ...risks.flatMap((risk) => risk.citations),
    ...conflicts.flatMap((conflict) => conflict.citations),
    ...uniqueEvaluationCitations
  ];
  const coveredPages = new Set(allVisibleCitations.flatMap((citation) =>
    citation.verified && citation.pdf_page_1based !== null
      ? [`${citation.document_sha256}:${citation.pdf_page_1based}`]
      : []
  ));
  const draftEvaluationFields = new Set(input.draft.evaluation.rules
    .filter((rule) => rule.effect !== "delete").map((rule) => rule.field)).size;
  const criticalClaims = input.draft.requirements.filter((item) => item.effect !== "delete").length +
    input.draft.risks.filter((risk) => risk.effect !== "delete" && risk.severity !== "low").length +
    draftEvaluationFields + conflicts.length;
  const criticalClaimsCited = activeRequirements.length +
    risks.filter((risk) => risk.severity !== "low").length + evaluationFieldsSupported + conflicts.length;
  const actualMicroUsd = input.costs.reduce((total, event) => total + (event.actual_micro_usd ?? 0), 0);
  const estimatedMicroUsd = input.costs.reduce(
    (total, event) => total + (event.actual_micro_usd === null ? event.estimated_micro_usd ?? 0 : 0),
    0
  );

  const result: AnalysisResult = {
    schema_version: "1.0",
    source_scope: "document_only",
    package_completeness: packageCompleteness,
    document_manifest: input.manifests,
    summary: safeSummary,
    claims,
    requirements,
    evaluation: { ...evaluationValues, citations: uniqueEvaluationCitations },
    risks,
    conflicts,
    clarification_questions: input.draft.clarification_questions,
    decision_readiness: !minimumCoverage
      ? "incomplete"
      : uniqueBlockingUnknowns.length > 0
        ? "needs_clarification"
        : "ready_for_bidder_assessment",
    blocking_unknowns: uniqueBlockingUnknowns,
    quality: {
      pages_total: input.manifests.reduce((total, manifest) => total + manifest.pages, 0),
      pages_covered: coveredPages.size,
      critical_claims: criticalClaims,
      critical_claims_cited: Math.min(criticalClaims, criticalClaimsCited),
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
