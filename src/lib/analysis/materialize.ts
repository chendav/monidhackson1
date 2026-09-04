import {
  AnalysisResultSchema,
  type AnalysisResult,
  type Citation,
  type CostEvent,
  type DocumentManifest
} from "@/contracts";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import { hasCompleteInfrastructureCostCoverage } from "@/lib/cost-estimates";
import {
  deriveDeadlineFactKey,
  deriveSourceFactKey,
  reconcileVersionedFacts
} from "@/lib/analysis/reconciliation";
import {
  recoverMandatoryTableAnchors,
  recoverSecurityRequirementAnchors,
  recoverSecurityChecklistConflictAnchors,
  recoverSummarySectionAnchors
} from "@/lib/analysis/source-anchors";
import {
  allCitationsVerified,
  assertionTokensSupportedByCitations,
  citationsMatchDocument,
  extractAssertionTokens,
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
  storageProvider?: "railway_s3" | "vercel_blob" | null;
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

function duplicateIds<T>(values: T[], getId: (value: T) => string): Set<string> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(getId(value), (counts.get(getId(value)) ?? 0) + 1);
  return new Set([...counts].flatMap(([id, count]) => count > 1 ? [id] : []));
}

function significantWords(value: string) {
  const ignored = new Set([
    "a", "an", "and", "are", "as", "at", "be", "been", "by", "for", "from", "has", "have",
    "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "will", "with"
  ]);
  return [...new Set(normalizeEvidenceText(value).match(/[a-z]{3,}/g)?.filter((word) => !ignored.has(word)) ?? [])];
}

/**
 * The Edmonton source qualifies only the adjacent "security guide" with
 * "(if applicable)"; the following checklist-to-annex reference remains a
 * definitive assertion. Remove that one local qualifier for polarity checks
 * only when the asserted annex label is the target of the same verified
 * relation. Conditions on the checklist or annex itself remain fail-closed.
 */
function sourceDefinitivenessScope(assertion: string, span: string) {
  const assertedAnnex = /^annex\s*["']?\s*([a-z])\s*["']?$/.exec(normalizeEvidenceText(assertion));
  if (!assertedAnnex) return span;
  const checklistRelation = /\bsecurity requirements? check\s*list\b\s+and\s+security guide\s*\(\s*if applicable\s*\)\s*,?\s*attached at\s+annex\s*["']?\s*([a-z])\b/.exec(span);
  if (!checklistRelation || checklistRelation[1] !== assertedAnnex[1]) return span;
  return span.replace(/\bsecurity guide\s*\(\s*if applicable\s*\)/, "security guide");
}

/**
 * Scalar matching prevents altered numbers and dates. This companion check
 * prevents a model from attaching a real quote to different prose (for
 * example, "Fake Contract" cited to "RFP title: Real Contract"). Extraction
 * is intentionally conservative: every meaningful asserted word must appear
 * somewhere in the verified evidence unless the complete assertion does.
 */
function proseAssertionSupportedByCitations(assertion: string, citations: Citation[]) {
  const normalizedAssertion = normalizeEvidenceText(assertion);
  const words = significantWords(assertion);
  const scalarKinds = new Map<string, number>();
  for (const token of extractAssertionTokens(assertion)) {
    const kind = token.split(":", 1)[0];
    scalarKinds.set(kind, (scalarKinds.get(kind) ?? 0) + 1);
  }
  const hasMultiValueScalarRole = [...scalarKinds.values()].some((count) => count > 1);
  const assertionIsNegative = NEGATIVE_OR_EXCLUSIVE_ASSERTION.test(normalizePolarityText(assertion));
  const evidenceSpans = citations.flatMap((citation) =>
    normalizePolarityText(citation.evidence_quote)
      .split(/(?<!a\.m)(?<!p\.m)\.\s+|[;\n]+|\b(?:while|whereas|but|although|yet)\b|\s+and\s+(?=(?:the|a|an|this|that|these|those|bidder|offeror|proponent|tenderer|contractor|supplier|vendor)\s+)/i)
      .map((span) => span.trim())
      .filter(Boolean)
  );

  return evidenceSpans.some((span) => {
    const spanIsNegative = NEGATIVE_OR_EXCLUSIVE_ASSERTION.test(span);
    if (spanIsNegative !== assertionIsNegative) return false;
    if (assertionIsDefinitive(assertion) &&
      !assertionIsDefinitive(sourceDefinitivenessScope(assertion, span))) return false;
    const assertionTokenSet = extractAssertionTokens(assertion);
    const sourceTokenSet = extractAssertionTokens(span);
    const relationCompletenessPrefixes = [
      "bound:", "currency:", "magnitude:", "percent:", "date:", "time:",
      "utc-offset:"
    ];
    if ([...sourceTokenSet].some((token) =>
      relationCompletenessPrefixes.some((prefix) => token.startsWith(prefix)) &&
      !assertionTokenSet.has(token)
    )) return false;
    if (normalizedAssertion.length >= 3 && span.includes(normalizedAssertion)) return true;
    // A bag of words cannot prove which subject owns which value when two
    // values of the same kind appear in one relation. Require the asserted
    // relation verbatim unless a field-specific role parser validates it.
    if (hasMultiValueScalarRole) return false;
    if (/\b(?:exceeds?|above|below|before|after|precedes?|follows?|greater than|less than|replaces?|supersedes?)\b/.test(normalizedAssertion)) {
      return false;
    }
    const evidenceWords = new Set(significantWords(span));
    return words.length === 0 || words.every((word) => evidenceWords.has(word));
  });
}

function riskDeadlineFactKeysFromFinding(value: string) {
  const normalized = normalizeEvidenceText(value);
  const keys = new Set<"deadline:questions" | "deadline:solicitation">();
  const questionSubject = /\b(?:questions?|enquir(?:y|ies)|clarifications?|q\s*(?:&|and)\s*a)\b/;
  const timingOrConsequence = /\b(?:close(?:s|d)?|closing|cut[ -]?off|deadline|due|received|submit(?:ted|ting|s)?|before|after|late|reject(?:ed|ion)?|non-compliant|noncompliant)\b/;
  if (questionSubject.test(normalized) && timingOrConsequence.test(normalized)) {
    keys.add("deadline:questions");
  }
  const solicitationSubject = /\b(?:solicitation|bids?|proposals?|tenders?|offers?|submissions?|closing (?:date|time)|late bids?)\b/;
  if (solicitationSubject.test(normalized) && timingOrConsequence.test(normalized)) {
    keys.add("deadline:solicitation");
  }
  if (keys.size === 0 && /\b(?:deadline|cut[ -]?off|closing (?:date|time))\b/.test(normalized)) {
    // A bare "cutoff" is genuinely ambiguous: it may mean the solicitation
    // or the question period. Preserve both candidates so a stale scalar is
    // withheld if either underlying deadline was superseded.
    keys.add("deadline:questions");
    keys.add("deadline:solicitation");
  }
  return keys;
}

export type RiskLineage =
  | { kind: "bound"; key: string }
  | { kind: "ambiguous"; candidateKeys: string[] }
  | { kind: "unbound" };

function riskEvidenceSpans(citations: Citation[], documentSha256: string) {
  return citations
    .filter((citation) => citation.verified && citation.document_sha256 === documentSha256)
    .flatMap((citation) => normalizeEvidenceText(citation.evidence_quote)
      .split(/(?<!a\.m)(?<!p\.m)\.\s+|[;\n]+|\b(?:while|whereas|but|although|yet)\b/i))
    .map((span) => span.trim())
    .filter(Boolean);
}

function spanSupportsRiskFinding(span: string, finding: string) {
  const scalarWords = new Set([
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday", "sunday", "mdt", "mst", "edt", "est", "cdt", "cst",
    "pdt", "pst", "utc", "gmt", "cad", "usd", "eur", "gbp"
  ]);
  const relationWords = significantWords(finding).filter((word) => !scalarWords.has(word));
  if (relationWords.length === 0) return false;
  const spanWords = new Set(significantWords(span).filter((word) => !scalarWords.has(word)));
  return relationWords.every((word) => spanWords.has(word));
}

function riskObjectKeysFromFinding(value: string) {
  const normalized = normalizeEvidenceText(value);
  const keys = new Set<string>();
  if (/\bclaim\b.{0,60}\b(?:exceeds?|above|greater than)\b.{0,60}\b(?:available\s+)?protection\b/.test(normalized)) {
    keys.add("insurance:coverage");
  }
  const insuranceContext = /\b(?:insurance|insured|commercial general liability|professional liability|errors and omissions|e\s*&\s*o|cgl)\b/.test(normalized);
  if (insuranceContext) {
    if (/\b(?:contact|representative|attention)\b/.test(normalized)) keys.add("insurance:contact");
    if (/\bdeductible\b/.test(normalized)) keys.add("insurance:deductible");
    if (/\bcertificat(?:e|ion)\b/.test(normalized)) keys.add("insurance:certificate");
    const hasProfessionalLiability = /\b(?:professional liability|errors and omissions|e\s*&\s*o)\b/.test(normalized);
    const hasCgl = /\b(?:commercial general liability|cgl)\b/.test(normalized);
    if (hasProfessionalLiability) {
      keys.add("insurance:professional-liability:coverage");
    }
    if (hasCgl) {
      keys.add("insurance:cgl:coverage");
    }
    const genericCoverage = /\b(?:insurance|insured)\b.{0,60}\b(?:coverage|policy\s+limit|coverage\s+limit|insured\s+amount|liability\s+coverage)\b/.test(normalized) ||
      /\b(?:coverage|policy\s+limit|coverage\s+limit|insured\s+amount|liability\s+coverage)\b.{0,60}\b(?:insurance|insured)\b/.test(normalized);
    if (!hasProfessionalLiability && !hasCgl &&
      !/\b(?:contact|representative|attention|deductible|certificat(?:e|ion))\b/.test(normalized) &&
      genericCoverage) keys.add("insurance:coverage");
  }
  if (/\bcontract\b/.test(normalized) &&
    /\b(?:end date|expiry|expiration|terminat(?:e|ion)|period ends?|contract term)\b/.test(normalized)) {
    keys.add("contract:end");
  }
  if (/\b(?:projection|projections|forecast|forecasts)\b/.test(normalized) &&
    /\b(?:horizon|end year|endpoint|extend|through|until|years? (?:out|beyond)|to 20\d{2})\b/.test(normalized)) {
    keys.add("projection:horizon");
  }
  return keys;
}

export function resolveRiskLineage(
  finding: string,
  citations: Citation[],
  documentSha256: string
): RiskLineage {
  const evidenceSpans = riskEvidenceSpans(citations, documentSha256);
  const findingSpans = normalizeEvidenceText(finding)
    .split(/(?<!a\.m)(?<!p\.m)\.\s+|[;\n]+|\b(?:while|whereas|but|although|yet)\b/i)
    .map((span) => span.trim())
    .filter(Boolean);
  if (findingSpans.length === 0 || findingSpans.some((findingSpan) =>
    !evidenceSpans.some((evidenceSpan) => spanSupportsRiskFinding(evidenceSpan, findingSpan))
  )) return { kind: "unbound" };

  const keys = new Set<string>();
  for (const findingSpan of findingSpans) {
    for (const key of riskObjectKeysFromFinding(findingSpan)) keys.add(key);
    for (const key of riskDeadlineFactKeysFromFinding(findingSpan)) keys.add(key);
    const sourceKey = deriveSourceFactKey({
      topic: "",
      value: findingSpan,
      documentSha256,
      citations
    });
    if (sourceKey) keys.add(sourceKey);
  }
  if (keys.size === 1) return { kind: "bound", key: [...keys][0] };
  if (keys.size > 1) return { kind: "ambiguous", candidateKeys: [...keys].toSorted() };
  return { kind: "unbound" };
}

function riskLineageFromDerivedText(
  value: string,
  citations: Citation[],
  documentSha256: string
): RiskLineage {
  // Impact and recommended action are model-authored. They may inherit the
  // verified finding's lineage, but may establish a different one only when
  // their own relation prose is present in the verified source.
  if (!proseAssertionSupportedByCitations(value, citations)) return { kind: "unbound" };
  return resolveRiskLineage(value, citations, documentSha256);
}

function riskSemanticallyDependsOnSupersededFact(
  risk: {
    topic: string; finding: string; impact: string; recommendedAction: string;
    documentSha256: string; citations: Citation[];
  },
  superseded: {
    topic: string; factKey?: string; value: string; documentSha256: string; citations: Citation[];
  },
  currentValues: string[]
) {
  const sourceObjectiveTokens = extractAssertionTokens(superseded.value);
  if (sourceObjectiveTokens.size === 0) return null;
  const currentObjectiveTokens = new Set(currentValues.flatMap((value) => [...extractAssertionTokens(value)]));
  const invalidatedSourceTokens = currentValues.length > 0
    ? [...sourceObjectiveTokens].filter((token) => !currentObjectiveTokens.has(token))
    : [...sourceObjectiveTokens];
  const sourceDeadlineKey = superseded.factKey?.startsWith("deadline:") ? superseded.factKey : null;
  const sourceObjectKey = sourceDeadlineKey ?? superseded.factKey ?? deriveSourceFactKey({
    topic: superseded.topic,
    value: superseded.value,
    documentSha256: superseded.documentSha256,
    citations: superseded.citations
  });
  if (!sourceObjectKey) return null;
  const findingLineage = resolveRiskLineage(risk.finding, risk.citations, risk.documentSha256);
  const inheritFindingLineage = (derived: RiskLineage, value: string) =>
    derived.kind === "bound" || findingLineage.kind !== "bound" ||
      extractAssertionTokens(value).size > 0
      ? derived
      : findingLineage;
  const components = [
    { value: risk.finding, lineage: findingLineage },
    {
      value: risk.impact,
      lineage: inheritFindingLineage(
        riskLineageFromDerivedText(risk.impact, risk.citations, risk.documentSha256),
        risk.impact
      )
    },
    {
      value: risk.recommendedAction,
      lineage: inheritFindingLineage(
        riskLineageFromDerivedText(risk.recommendedAction, risk.citations, risk.documentSha256),
        risk.recommendedAction
      )
    }
  ];
  let matchingStaleComponent = false;
  let ambiguous = false;
  let unboundDerivedStaleScalar = false;
  for (const [index, { value, lineage }] of components.entries()) {
    const objectiveTokens = extractAssertionTokens(value);
    if (!invalidatedSourceTokens.some((token) => objectiveTokens.has(token))) continue;
    if (lineage.kind === "bound" && lineage.key === sourceObjectKey) {
      matchingStaleComponent = true;
    }
    if (lineage.kind === "ambiguous" && lineage.candidateKeys.includes(sourceObjectKey)) {
      ambiguous = true;
    }
    // Impact/action prose is model-authored. If it repeats an invalidated
    // scalar but its own relation is absent from the source, it must not
    // inherit the finding's otherwise valid lineage and remain publishable.
    if (index > 0 && lineage.kind === "unbound") unboundDerivedStaleScalar = true;
  }
  if (matchingStaleComponent && findingLineage.kind === "bound" &&
    findingLineage.key === sourceObjectKey) return "stale" as const;
  if (matchingStaleComponent || unboundDerivedStaleScalar) return "mixed" as const;
  return ambiguous ? "ambiguous" as const : null;
}

function evaluationCitationIsRelevant(field: EvaluationField, citation: Citation) {
  const quote = normalizeEvidenceText(citation.evidence_quote);
  switch (field) {
    case "mandatory_gate":
      return /\bmandatory\b/.test(quote) && (
        /\b(fail|failed|fails|non-compliant|noncompliant|must|required|responsive)\b/.test(quote) ||
        /\b(?:meet|meets|satisfy|satisfies)\s+all\s+mandatory\b/.test(quote) ||
        /\bmandatory\b.{0,40}\b(?:must|required to)\s+be\s+(?:met|satisfied)\b/.test(quote)
      );
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

type SelectionMethodSignature =
  | "highest_combined_rating"
  | "lowest_evaluated_price"
  | "lowest_price"
  | "best_value"
  | "highest_score";

const SELECTION_METHOD_SOURCE =
  "(highest\\s+combined\\s+rating|lowest\\s+evaluated\\s+(?:total\\s+)?price|" +
  "lowest\\s+(?:total\\s+)?price|best\\s+value|highest\\s+(?:technical\\s+)?score)";

function normalizePolarityText(value: string) {
  return normalizeEvidenceText(value)
    .replace(/\bcan't\b/g, "cannot")
    .replace(/\bwon't\b/g, "will not")
    .replace(/\bain't\b/g, "is not")
    .replace(/\b(is|are|was|were|has|have|had|does|do|did|would|should|could|must|may|might)n't\b/g, "$1 not");
}

const CONDITIONAL_ASSERTION = /\b(?:if|unless|when|once|provided(?: that)?|assuming|pending|contingent|conditional(?:ly)?\s+on|conditioned\s+on|on\s+condition\s+that|subject(?: only)?\s+to|only\s+(?:if|after)|in\s+the\s+event)\b|\b(?:following|after|on|upon|effective\s+(?:after|on|upon))\b.{0,60}\b(?:approval|approved|authorization|authorized|acceptance|accepted|funding|exercise|execution|option)\b/;
const NON_DEFINITIVE_ASSERTION = /\b(?:may|might|can|could|would|should|proposed|proposal|draft|expected|anticipated|possible|potential|option|alternative)\b/;
const NEGATIVE_OR_EXCLUSIVE_ASSERTION = /\bnot\b(?!\s+(?:less|more)\s+than\b|\s+exceed(?:ing)?\b)|\b(?:never|neither|nor|no longer|cannot|under no circumstances|anything but|everything but|other than|different from|unrelated to|without(?:\s+the\s+(?:use|application)\s+of)?|excluded?|optional)\b|\bno\s+(?!later\s+than\b|less\s+than\b|more\s+than\b)/;

function assertionIsDefinitive(value: string) {
  const normalized = normalizePolarityText(value);
  return !NON_DEFINITIVE_ASSERTION.test(normalized) &&
    !CONDITIONAL_ASSERTION.test(normalized) &&
    !NEGATIVE_OR_EXCLUSIVE_ASSERTION.test(normalized);
}

function selectionMethodSignature(value: string): SelectionMethodSignature | null {
  const normalized = normalizeEvidenceText(value);
  const signatures = new Set<SelectionMethodSignature>();
  if (/\bhighest\s+combined\s+rating\b/.test(normalized)) signatures.add("highest_combined_rating");
  if (/\blowest\s+evaluated\s+(?:total\s+)?price\b/.test(normalized)) {
    signatures.add("lowest_evaluated_price");
  } else if (/\blowest\s+(?:total\s+)?price\b/.test(normalized)) {
    signatures.add("lowest_price");
  }
  if (/\bbest\s+value\b/.test(normalized)) signatures.add("best_value");
  if (/\bhighest\s+(?:technical\s+)?score\b/.test(normalized)) signatures.add("highest_score");
  return signatures.size === 1 ? [...signatures][0] : null;
}

function selectionRelationsInCitation(citation: Citation) {
  const quote = normalizePolarityText(citation.evidence_quote);
  const relations = new Set<SelectionMethodSignature>();
  const negative = /\b(?:not|never|no longer|cannot|must not|shall not|excluded?|excluding|except(?:ed|ing)?|prohibited|other[ -]than|anything[ -]but|everything[ -]but|rather[ -]than|instead[ -]of|as[ -]opposed[ -]to|apart[ -]from|save(?: for)?|in[ -]lieu[ -]of|exclusive[ -]of|disregard(?:s|ed|ing)?|regardless[ -]of|by no means|without[ -]regard(?:[ -]to)?|irrespective(?:[ -]of)?)\b/;
  const scoringContext = /\b(?:award|evaluation|scoring|rating|ranking|price|technical|financial)\s+points?\b|\b(?:ranking|proximity|difference|distance|variance)\s+(?:from|to)\b/;
  const segments = quote
    .split(/(?<!a\.m)(?<!p\.m)\.\s+|[;\n]+|\b(?:while|whereas|but)\b/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const expressions = [
    new RegExp(
      `\\b(?:award|selection)\\b.{0,80}?\\b(?:uses?|based\\s+on|determined\\s+by|` +
      `will\\s+be\\s+made\\s+to|shall\\s+be\\s+made\\s+to)\\b.{0,140}?` +
      `\\b${SELECTION_METHOD_SOURCE}\\b`,
      "g"
    ),
    new RegExp(
      `\\b(?:selects?|recommends?|awards?)\\b.{0,140}?\\b${SELECTION_METHOD_SOURCE}\\b`,
      "g"
    ),
    new RegExp(
      `\\b${SELECTION_METHOD_SOURCE}\\b.{0,140}?` +
      "\\b(?:will|shall)\\s+be\\s+(?:selected|recommended|awarded)\\b",
      "g"
    ),
    new RegExp(
      `\\b(?:bids?|offers?|proposals?|tenders?)\\b.{0,100}?\\bwith\\b.{0,100}?` +
      `\\b${SELECTION_METHOD_SOURCE}\\b.{0,100}?` +
      "\\b(?:(?:will|shall)\\s+be\\s+(?:selected|recommended|awarded)|for\\s+award)\\b",
      "g"
    )
  ];
  for (const segment of segments) {
    if (!assertionIsDefinitive(segment) || negative.test(segment) || scoringContext.test(segment) || /\b(?:calculate|calculation|formula|financial points?)\b/.test(segment) &&
      !/\b(?:selection|select(?:ed|ion)?|will be awarded|will be recommended)\b/.test(segment)) continue;
    for (const expression of expressions) {
      expression.lastIndex = 0;
      for (const match of segment.matchAll(expression)) {
        const signature = selectionMethodSignature(match[1]);
        if (signature) relations.add(signature);
      }
    }
  }
  return relations;
}

type SubmissionMethodSignature =
  | "email"
  | "portal"
  | "electronic"
  | "fax"
  | "postal_mail"
  | "courier"
  | "hand_delivery";

function submissionMethodSignatures(value: string) {
  const normalized = normalizeEvidenceText(value);
  const signatures = new Set<SubmissionMethodSignature>();
  if (/\be-?mail(?:ed|ing|s)?\b|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/.test(normalized)) {
    signatures.add("email");
  }
  if (/\b(?:portal|canadabuys|buyandsell|epost|e-?procurement)\b/.test(normalized)) {
    signatures.add("portal");
  }
  if (/\belectronic(?:ally)?\b/.test(normalized)) signatures.add("electronic");
  if (/\bfax(?:ed|ing|es)?\b/.test(normalized)) signatures.add("fax");
  if (/\b(?:postal mail|registered mail)\b|(?<!e-)\bmail(?:ed|ing)?\b/.test(normalized)) {
    signatures.add("postal_mail");
  }
  if (/\bcourier(?:ed|ing|s)?\b/.test(normalized)) signatures.add("courier");
  if (/\b(?:hand delivery|hand-deliver(?:ed|y)?|in person)\b/.test(normalized)) {
    signatures.add("hand_delivery");
  }
  if (signatures.has("portal") || signatures.has("email")) signatures.delete("electronic");
  return signatures;
}

function submissionRelationClauses(citation: Citation) {
  const quote = normalizePolarityText(citation.evidence_quote);
  const negative = /\b(?:not|never|no longer|cannot|must not|shall not|may not|prohibited|excluded?|excluding|except(?:ed|ing)?|other[ -]than|anything[ -]but|everything[ -]but|rather[ -]than|instead[ -]of|as[ -]opposed[ -]to|apart[ -]from|save(?: for)?|in[ -]lieu[ -]of|exclusive[ -]of|disregard(?:s|ed|ing)?|regardless[ -]of|by no means|will not be accepted|reject(?:ed|ion)?|unacceptable|invalid|non-compliant|noncompliant)\b/;
  const relationClauses: string[] = [];
  for (const sentence of quote.split(/(?<!a\.m)(?<!p\.m)\.\s+|[\n]+/)) {
    if (!assertionIsDefinitive(sentence)) continue;
    const topLevelLabel = /(?:^|[;])\s*(?:submission method|return bids to)\s*:/.test(sentence);
    const sentenceTenderSubject = /\b(?:bids?|proposals?|tenders?|offers?|responses?|submissions?)\b/.test(sentence);
    const sentenceSubmitAction = /\b(?:submit(?:ted|ting|s)?|send|sent|return(?:ed|ing|s)?|upload(?:ed|ing|s)?|deliver(?:ed|ing|s)?|e-?mail(?:ed|ing|s)?|courier(?:ed|ing|s)?)\b/.test(sentence);
    const sentenceUnrelatedSubject = /\b(?:questions?|enquir(?:y|ies)|clarifications?|invoices?|payments?|billing|timesheets?)\b/.test(sentence);
    const sentenceTenderArtifact = /\b(?:bid|proposal|tender|offer|response|submission)\s+(?:security|bond|samples?|attachments?|copies|forms?|certificates?|appendix|schedule)\b/.test(sentence);
    const sentenceHasChannel = submissionMethodSignatures(sentence).size > 0;
    if (!negative.test(sentence) && !sentenceUnrelatedSubject && !sentenceTenderArtifact &&
      sentenceHasChannel && (topLevelLabel || (sentenceTenderSubject && sentenceSubmitAction))) {
      relationClauses.push(sentence.trim());
    }
    for (const clause of sentence.split(/[;,]+|\b(?:while|whereas)\b/).map((item) => item.trim())) {
      if (!clause || negative.test(clause)) continue;
      const exactLabel = /(?:^|\s)(?:submission method|return bids to)\s*:/.test(clause);
      const tenderSubject = /\b(?:bids?|proposals?|tenders?|offers?|responses?|submissions?)\b/.test(clause);
      const submitAction = /\b(?:submit(?:ted|ting|s)?|send|sent|return(?:ed|ing|s)?|upload(?:ed|ing|s)?|deliver(?:ed|ing|s)?|e-?mail(?:ed|ing|s)?|courier(?:ed|ing|s)?)\b/.test(clause);
      const unrelatedSubject = /\b(?:questions?|enquir(?:y|ies)|clarifications?|invoices?|payments?|billing|timesheets?)\b/.test(clause);
      const tenderArtifact = /\b(?:bid|proposal|tender|offer|response|submission)\s+(?:security|bond|samples?|attachments?|copies|forms?|certificates?|appendix|schedule)\b/.test(clause);
      const hasChannel = submissionMethodSignatures(clause).size > 0;
      if (!unrelatedSubject && !tenderArtifact && (exactLabel || (tenderSubject && submitAction) ||
        (topLevelLabel && hasChannel))) relationClauses.push(clause);
    }
  }
  return relationClauses;
}

function citationSupportsSubmissionMethod(value: string, citation: Citation) {
  const expected = submissionMethodSignatures(value);
  const relationClauses = submissionRelationClauses(citation);
  if (relationClauses.length === 0) return false;
  const supported = new Set(relationClauses.flatMap((clause) => [...submissionMethodSignatures(clause)]));
  if (expected.size > 0) {
    return supported.size === 1 && expected.size === 1 && supported.has([...expected][0]);
  }
  const normalizedValue = normalizeEvidenceText(value);
  return relationClauses.filter((clause) => clause.includes(normalizedValue)).length === 1;
}

type WeightField = "technical_weight" | "financial_weight";

function weightLabelsIn(value: string): Set<"technical" | "financial"> {
  const labels = new Set<"technical" | "financial">();
  if (/\btechnical\b/.test(value)) labels.add("technical");
  if (/\b(?:financial|price)\b/.test(value)) labels.add("financial");
  return labels;
}

function explicitPercentages(value: string): number[] {
  return [...value.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:%|per\s*cent|percent(?:age)?)(?![a-z])/g)]
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number >= 0 && number <= 100);
}

/**
 * Extracts percentages only when the surrounding clause identifies which
 * evaluation component they belong to. Merely finding both 70 and 30 in a
 * quote is deliberately insufficient: that would allow the two weights to be
 * swapped by the model while still passing scalar-token validation.
 */
function boundWeightValues(field: WeightField, citation: Citation): Set<number> {
  const target = field === "technical_weight" ? "technical" : "financial";
  const quote = normalizeEvidenceText(citation.evidence_quote);
  const values = new Set<number>();
  const clauses = quote.split(/(?:[,;+]|\b(?:and|while|whereas|versus|vs\.?)\b)/);

  for (const clause of clauses) {
    if (!assertionIsDefinitive(clause)) continue;
    const labels = weightLabelsIn(clause);
    const percentages = explicitPercentages(clause);
    if (labels.size === 1 && labels.has(target) && percentages.length === 1) {
      values.add(percentages[0]);
    }
  }

  // PDF table extraction often removes punctuation. Support the two common
  // interleaved layouts while refusing to infer a value across another label.
  const targetPattern = target === "technical" ? "technical" : "(?:financial|price)";
  const otherPattern = target === "technical" ? "(?:financial|price)" : "technical";
  const numberPattern = "(\\d+(?:\\.\\d+)?)\\s*(?:%|per\\s*cent|percent(?:age)?)";
  const clauseBoundary = "[,;+]|\\b(?:and|while|whereas|versus|vs\\.?)\\b";
  const labelThenNumber = new RegExp(
    `\\b${targetPattern}\\b(?:(?!\\b${otherPattern}\\b|${clauseBoundary}|\\d).){0,80}?${numberPattern}`,
    "g"
  );
  const numberThenLabel = new RegExp(
    `${numberPattern}(?:(?!\\b${otherPattern}\\b|${clauseBoundary}|\\d).){0,80}?\\b${targetPattern}\\b`,
    "g"
  );
  if (assertionIsDefinitive(quote)) {
    for (const match of quote.matchAll(labelThenNumber)) values.add(Number(match[1]));
    for (const match of quote.matchAll(numberThenLabel)) values.add(Number(match[1]));
  }
  return values;
}

function parseThresholdValue(value: string): { minimum: number; scale: number | null } | null {
  const normalized = normalizeEvidenceText(value);
  const fraction = normalized.match(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)(?![\d.])/);
  if (fraction) return { minimum: Number(fraction[1]), scale: Number(fraction[2]) };
  const numbers = [...normalized.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)(?![\d.])/g)].map((match) => Number(match[1]));
  return numbers.length === 1 && Number.isFinite(numbers[0])
    ? { minimum: numbers[0], scale: null }
    : null;
}

function citationThresholdBinding(citation: Citation): { minimums: Set<number>; scales: Set<number> } {
  const quote = normalizeEvidenceText(citation.evidence_quote);
  const minimums = new Set<number>();
  const scales = new Set<number>();
  const numberPattern = "(\\d+(?:\\.\\d+)?)";
  const minimumBefore = new RegExp(`\\b(?:minimum(?: score)?(?: of)?|threshold(?: of)?|at least|no less than)\\b[^\\d]{0,60}${numberPattern}`, "g");
  const minimumAfter = new RegExp(`${numberPattern}\\s*(?:points?)?[^\\d]{0,30}\\b(?:is|as)?\\s*(?:the\\s+)?(?:minimum|threshold)\\b`, "g");
  const requiredScore = new RegExp(`\\b(?:must|required to)\\s+(?:obtain|achieve|score|receive|attain)\\b[^\\d]{0,60}${numberPattern}`, "g");
  const fraction = /(?<![\d.])(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?![\d.])/g;
  const outOf = /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:points?)?\s*(?:out of|on (?:a )?scale of)\s*(?:a\s+possible\s+)?(\d+(?:\.\d+)?)(?![\d.])/g;
  const scaleOnly = /\b(?:out of|scale of|possible(?: score)?(?: of)?|maximum(?: score)?(?: of)?)\b[^\d]{0,30}(\d+(?:\.\d+)?)/g;

  const affirmativeSpans = quote
    .split(/(?<!a\.m)(?<!p\.m)\.\s+|[;,\n]+/)
    .map((span) => span.trim())
    .filter((span) => span && assertionIsDefinitive(span));
  for (const span of affirmativeSpans) {
    for (const match of span.matchAll(minimumBefore)) minimums.add(Number(match[1]));
    for (const match of span.matchAll(minimumAfter)) minimums.add(Number(match[1]));
    for (const match of span.matchAll(requiredScore)) minimums.add(Number(match[1]));
    for (const match of span.matchAll(fraction)) {
      minimums.add(Number(match[1]));
      scales.add(Number(match[2]));
    }
    for (const match of span.matchAll(outOf)) {
      minimums.add(Number(match[1]));
      scales.add(Number(match[2]));
    }
    for (const match of span.matchAll(scaleOnly)) scales.add(Number(match[1]));
  }
  return { minimums, scales };
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
    if (normalizedValue === "true") {
      const affirmative = relevant.filter((citation) => assertionIsDefinitive(citation.evidence_quote));
      return allCitationsVerified(affirmative) ? affirmative : null;
    }
    if (normalizedValue === "false" && /\b(no|not|without)\b.{0,40}\bmandatory\b/.test(combinedEvidence)) {
      return relevant;
    }
    return null;
  }
  if (field === "technical_weight" || field === "financial_weight") {
    const parsed = Number(value.replace(/%/g, "").trim());
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
    const bindings = relevant.map((citation) => ({ citation, values: boundWeightValues(field, citation) }));
    const allBoundValues = new Set(bindings.flatMap((binding) => [...binding.values]));
    if (allBoundValues.size !== 1 || !allBoundValues.has(parsed)) return null;
    const boundCitations = bindings.filter((binding) => binding.values.has(parsed)).map((binding) => binding.citation);
    return allCitationsVerified(boundCitations) ? boundCitations : null;
  }
  if (field === "rated_threshold") {
    const expected = parseThresholdValue(value);
    if (!expected) return null;
    const bindings = relevant.map((citation) => ({ citation, ...citationThresholdBinding(citation) }));
    const minimums = new Set(bindings.flatMap((binding) => [...binding.minimums]));
    if (minimums.size !== 1 || !minimums.has(expected.minimum)) return null;
    if (expected.scale !== null) {
      const scales = new Set(bindings.flatMap((binding) => [...binding.scales]));
      if (scales.size !== 1 || !scales.has(expected.scale)) return null;
    }
    const boundCitations = bindings.filter((binding) =>
      binding.minimums.has(expected.minimum) &&
      (expected.scale === null || binding.scales.has(expected.scale))
    ).map((binding) => binding.citation);
    return allCitationsVerified(boundCitations) ? boundCitations : null;
  }
  if (field === "selection_method") {
    const expected = selectionMethodSignature(value);
    if (!expected) return null;
    const boundCitations = relevant.filter((citation) => {
      const relations = selectionRelationsInCitation(citation);
      return relations.size === 1 && relations.has(expected);
    });
    return allCitationsVerified(boundCitations) ? boundCitations : null;
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
  closing_date: /\b(closing(?: date| time)?|submission (?:date|deadline)|bid deadline|tender deadline|solicitation deadline)\b/i,
  overview: /\b(overview|summary|project description|scope)\b/i,
  scope: /\b(scope|deliverable|service|statement of work|work requirement)\b/i,
  submission_method: /\b(submission|submit)\b.*\b(method|portal|email|electronic|instructions?)\b/i,
  current_selection_method: /\b(selection|award)\b.*\b(method|basis|rating|price)\b/i
} as const;

type SummaryField = keyof typeof SUMMARY_TOPIC_PATTERNS;
type AnchoredSpan = { full: string; value: string; context: string };

const STRONG_FIELD_ANCHORS: ReadonlyArray<readonly [string, SummaryField | "question_deadline"]> = [
  ["\\b(?:rfp|tender|solicitation)\\s+(?:title|name)\\b", "title"],
  ["^title\\s*(?=[:#=-])", "title"],
  ["\\b(?:solicitation|tender|rfp|reference)\\s*(?:number\\b|no\\.?|id\\b)", "solicitation_number"],
  ["\\b(?:issuer|buyer|contracting authority|department|agency)\\b", "issuer"],
  ["\\bproposal to\\s*(?=[:#=-])", "issuer"],
  ["\\b(?:(?:solicitation|bid|tender)\\s+)?(?:closing date|closing time)|\\b(?:solicitation|bid|tender)\\s+close(?:s|d)?\\b|\\b(?:submission deadline|submission date|bid deadline|tender deadline|solicitation deadline)\\b", "closing_date"],
  ["\\b(?:questions?|enquir(?:y|ies)|clarifications?)\\b.{0,40}\\b(?:close|closes|closing|cut[ -]?off|deadline|due|received|submitted)\\b", "question_deadline"],
  ["\\bdeadline\\s+for\\s+(?:submitting\\s+)?(?:questions?|enquir(?:y|ies)|clarifications?)\\b", "question_deadline"],
  ["\\b(?:q\\s*(?:&|and)\\s*a|question(?:s)?[- ]and[- ]answer(?:s)?)\\s+(?:close|closing|cut[ -]?off|deadline|due)\\b", "question_deadline"],
  ["\\bsubmission (?:method|portal|instructions?)\\b", "submission_method"],
  ["\\b(?:selection|award)(?: method| basis| criterion| criteria)?\\b", "current_selection_method"]
];

function nextFieldLabelStart(value: string, after: number) {
  const suffix = value.slice(after);
  // A generic label boundary must begin after punctuation. Without that
  // guard, components inside one structured timestamp ("At: 2:00 ... On:")
  // would be mistaken for independent fields.
  const match = /(?:[,;]|\.\s+)\s*[\p{L}][\p{L}\p{N}&/()' -]{0,48}:(?=\s|$)/u.exec(suffix);
  return match?.index === undefined ? null : after + match.index;
}

function firstSentenceBoundary(value: string, start: number, maximum: number) {
  const suffix = value.slice(start, maximum);
  for (const match of suffix.matchAll(/[;\n]|\.\s+/g)) {
    const boundary = start + match.index;
    const prefix = value.slice(Math.max(start, boundary - 5), boundary + 1);
    if (/\b[ap]\.m\.$/.test(prefix)) continue;
    return boundary;
  }
  return maximum;
}

function anchoredFieldSpans(field: SummaryField, quote: string): AnchoredSpan[] {
  if (!["title", "solicitation_number", "issuer", "closing_date", "submission_method",
    "current_selection_method"].includes(field)) {
    return SUMMARY_TOPIC_PATTERNS[field].test(quote)
      ? [{ full: quote, value: quote, context: quote }]
      : [];
  }
  const normalized = normalizeEvidenceText(quote);
  const anchors = STRONG_FIELD_ANCHORS.flatMap(([source, anchorField]) =>
    [...normalized.matchAll(new RegExp(source, "g"))].map((match) => ({
      field: anchorField,
      start: match.index,
      end: match.index + match[0].length
    }))
  ).sort((left, right) => left.start - right.start || left.end - right.end);

  return anchors.flatMap((anchor, index): AnchoredSpan[] => {
    if (anchor.field !== field) return [];
    const nextAnchor = anchors.slice(index + 1).find((candidate) => candidate.start >= anchor.end);
    const nextLabel = nextFieldLabelStart(normalized, anchor.end);
    const maximum = Math.min(nextAnchor?.start ?? normalized.length, nextLabel ?? normalized.length);
    const end = firstSentenceBoundary(normalized, anchor.end, maximum);
    const sourceSpan = normalized.slice(anchor.start, end).trim();
    const rawValue = normalized.slice(anchor.end, end)
      .replace(/^\s*(?:(?:is|are)\s+)?(?:(?:has|have)\s+been\s+)?(?:revised|changed|extended|updated)?\s*(?:to)?\s*[:#=-]?\s*/i, "")
      .replace(/[\s,.:;=-]+$/g, "")
      .trim();
    if (!rawValue) return [];
    const prefix = normalized.slice(0, anchor.start);
    const previousBoundary = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf(";"), prefix.lastIndexOf("\n"));
    const context = normalized.slice(previousBoundary < 0 ? 0 : previousBoundary + 1, end).trim();
    return [{ full: sourceSpan, value: rawValue, context }];
  });
}

function citationSupportsSummaryValue(field: SummaryField, value: string, citation: Citation) {
  if (!citation.verified) return false;
  if (field === "submission_method") {
    return citationSupportsSubmissionMethod(value, citation) &&
      assertionTokensSupportedByCitations(value, [citation]) &&
      proseAssertionSupportedByCitations(value, [citation]);
  }
  if (field === "current_selection_method") {
    const expected = selectionMethodSignature(value);
    const relations = selectionRelationsInCitation(citation);
    return Boolean(expected && relations.size === 1 && relations.has(expected) &&
      assertionTokensSupportedByCitations(value, [citation]) &&
      proseAssertionSupportedByCitations(value, [citation]));
  }
  const spans = anchoredFieldSpans(field, citation.evidence_quote);
  return spans.some((span) => {
    const definitiveCoverLabel = field === "issuer" && /^proposal to\s*:/.test(span.full);
    if (!definitiveCoverLabel && !assertionIsDefinitive(span.context)) return false;
    if (field === "closing_date") {
      if (/\b(?:questions?|enquir(?:y|ies)|clarifications?)\b/i.test(span.full)) return false;
      if (/\b(?:insurance|security(?: clearance)?|invoice|payment|certificate|bond|sample|deliverable|milestone)\b.{0,80}\b(?:submission deadline|submission date|deadline|due date|expiry|expiration)\b/i.test(span.context)) {
        return false;
      }
      if (/\b(?:before|after|differs? from|different from|earlier than|later than|prior to|subsequent to|other than)\b/i.test(span.full)) {
        return false;
      }
      const objective = [...extractAssertionTokens(span.full)];
      const distinct = (prefix: string) => objective.filter((token) => token.startsWith(prefix)).length;
      if (distinct("date:") > 1 || distinct("time:") > 1 ||
        distinct("timezone:") > 1 || distinct("utc-offset:") > 1) {
        // A legitimate amendment may state both old and new timestamps. Only
        // the value after an explicit target connector may support the current
        // closing value; merely appearing elsewhere in the span is unsafe.
        const target = span.full.match(
          /\b(?:revised|changed|extended|updated)\b.*\b(?:to|until|through)\b\s*(.+)$/
        )?.[1];
        if (!target || !assertionTokensSupportedByCitations(value, [{
          ...citation, evidence_quote: target
        }])) return false;
      }
    }
    const exactValueField = ["title", "solicitation_number", "issuer"].includes(field);
    const scopedCitation = { ...citation, evidence_quote: exactValueField ? span.value : span.full };
    if (!assertionTokensSupportedByCitations(value, [scopedCitation]) ||
      !proseAssertionSupportedByCitations(value, [scopedCitation])) return false;
    return exactValueField
      ? normalizeEvidenceText(value) === span.value
      : true;
  });
}

function summaryFieldForAssertion(topic: string, value: string): SummaryField | undefined {
  const assertedContext = `${topic} ${value}`;
  return (["title", "solicitation_number", "issuer", "closing_date", "submission_method",
    "current_selection_method"] as const)
    .find((candidate) => SUMMARY_TOPIC_PATTERNS[candidate].test(assertedContext));
}

function topicFieldBindingSupported(topic: string, value: string, citations: Citation[]) {
  const assertedContext = `${topic} ${value}`;
  const field = summaryFieldForAssertion(topic, value);
  if (field === "closing_date" &&
    /\b(?:insurance|security|deliverable|milestone|invoice|payment)\b.{0,50}\b(?:certificate|deadline|due date|expiry|expiration)\b/i.test(assertedContext)) {
    // An operational deadline may contain "submission deadline" without
    // being the solicitation closing field. It remains eligible as a cited
    // fact but can never populate summary.closing_date.
    return true;
  }
  if (field === "closing_date" && ![...extractAssertionTokens(value)].some((token) =>
    /^(?:date|time|timezone|utc-offset):/.test(token)
  )) {
    // Consequences such as "bids received after the closing time are rejected"
    // refer to the field without asserting its scalar value. Keep them eligible
    // as grounded risks; only scalar closing assertions need field-span binding.
    return true;
  }
  if (field === "closing_date" &&
    deriveDeadlineFactKey(value, citations) === "deadline:questions" &&
    /\b(?:questions?|enquir(?:y|ies)|clarifications?|request for clarification)\b/i.test(value)) {
    // The model mislabeled the topic, but the server can still safely route the
    // fact into the question-deadline chain. It cannot populate closing_date
    // because summary publication independently requires a closing span.
    return true;
  }
  return !field || citations.some((citation) => citationSupportsSummaryValue(field, value, citation));
}

function canonicalizeTypedSourceClaim(
  claim: DraftAnalysis["claims"][number]
): DraftAnalysis["claims"][number] {
  if (claim.claim_type !== "source" || claim.effect === "delete") return claim;
  const field = (["title", "solicitation_number", "issuer"] as const)
    .find((candidate) => SUMMARY_TOPIC_PATTERNS[candidate].test(claim.topic));
  if (!field) return claim;
  const wrappers: Record<typeof field, RegExp> = {
    title: /^(?:the\s+)?(?:solicitation|tender|rfp)\s+(?:title|name)\s+(?:is|:)\s*(.+?)\.?$/i,
    solicitation_number: /^(?:the\s+)?(?:solicitation|tender|rfp|reference)\s+(?:number|no\.?|id)\s+(?:is|:)\s*(.+?)\.?$/i,
    issuer: /^(?:the\s+)?(?:issuer|buyer|contracting authority|department|agency)\s+(?:is|:)\s*(.+?)\.?$/i
  };
  const match = wrappers[field].exec(claim.claim_text.trim());
  const canonical = match?.[1]?.trim();
  return canonical ? { ...claim, claim_text: canonical } : claim;
}

function mandatoryCategorySupported(text: string, citations: Citation[]) {
  const mandatoryLanguage = /\bmandatory\b|\bcondition(?:s)? of (?:bid|tender)\b|\bnon-compliant\b|\bnoncompliant\b|\b(?:bidder|offeror|proponent|tenderer)\b.{0,100}\b(?:must|shall|required to)\b.{0,100}\b(?:submit|provide|demonstrate|propose|include|complete|sign|obtain)\b/;
  return citations.some((citation) => normalizePolarityText(citation.evidence_quote)
    .split(/(?<!a\.m)(?<!p\.m)\.\s+|[;\n]+|\s+and\s+(?=(?:the|a|an|this|that|these|those|bidder|offeror|proponent|tenderer|contractor|supplier|vendor)\s+)/)
    .map((span) => span.trim())
    .filter(Boolean)
    .some((span) => assertionIsDefinitive(span) && mandatoryLanguage.test(span) &&
      proseAssertionSupportedByCitations(text, [{ ...citation, evidence_quote: span }])));
}

function isMandatoryLocationReference(text: string) {
  const normalized = normalizePolarityText(text);
  const pointsToContainer = /\bmandatory\b.{0,80}\b(?:criteria|requirements?)\b.{0,80}\b(?:included|contained|located|set out|found|provided|listed|described)\b.{0,50}\b(?:annex|appendix|attachment|section)\b/.test(normalized);
  const containsBidderObligation = /\b(?:bidder|offeror|proponent|tenderer)\b.{0,120}\b(?:must|shall|required to)\b/.test(normalized);
  return pointsToContainer && !containsBidderObligation;
}

function sourceBackedSupportingDetail(value: string | null, citations: Citation[]) {
  if (!value) return null;
  return assertionTokensSupportedByCitations(value, citations) &&
    proseAssertionSupportedByCitations(value, citations)
    ? value
    : null;
}

export function materializeAnalysis(input: MaterializeInput): {
  result: AnalysisResult;
  receipts: QuoteVerificationReceipt[];
} {
  const generatedAt = input.generatedAt ?? new Date();
  const receipts: QuoteVerificationReceipt[] = [];
  const recoveredSummaryClaims = recoverSummarySectionAnchors(input.draft, input.documents);
  const recoveredSummaryClaimIds = new Set(recoveredSummaryClaims.map((claim) => claim.claim_id));
  const recoveredClaims = [
    ...recoverSecurityChecklistConflictAnchors(input.draft, input.documents),
    ...recoveredSummaryClaims
  ];
  const recoveredSecurityRequirements = recoverSecurityRequirementAnchors(
    input.draft,
    input.documents
  );
  const recoveredRequirements = [
    ...recoverMandatoryTableAnchors(input.draft, input.documents),
    ...recoveredSecurityRequirements
  ];
  const recoveredClaimIds = new Set(recoveredClaims.map((claim) => claim.claim_id));
  const recoveredRequirementIds = new Set(recoveredRequirements.map((requirement) => requirement.id));
  const recoveredSecurityRequirementIds = new Set(
    recoveredSecurityRequirements.map((requirement) => requirement.id)
  );
  const securityAnchorKey = (claim: DraftAnalysis["claims"][number]) => {
    const sourceText = `${claim.topic} ${claim.citations.map((citation) => citation.evidence_quote).join(" ")}`;
    return /^annex\s+[a-z]$/i.test(claim.claim_text.trim()) &&
      /security requirements?\s+check\s*list/i.test(sourceText)
      ? `${claim.document_sha256}:${normalizeEvidenceText(claim.claim_text)}`
      : null;
  };
  const summaryAnchorKey = (claim: DraftAnalysis["claims"][number]) => {
    const topic = normalizeEvidenceText(claim.topic);
    return (topic === "overview" || topic === "scope") && claim.claim_text.trim()
      ? `${claim.document_sha256}:${topic}:${normalizeEvidenceText(claim.claim_text)}`
      : null;
  };
  const mandatoryAnchorKey = (requirement: DraftAnalysis["requirements"][number]) => {
    if (requirement.category !== "mandatory") return null;
    const labels = new Set(requirement.citations.flatMap((citation) => {
      const normalized = normalizeEvidenceText(citation.section ?? "");
      return /^m\d{1,3}$/.test(normalized) ? [normalized] : [];
    }));
    return labels.size === 1
      ? `${requirement.document_sha256}:${[...labels][0]}`
      : null;
  };
  const securityRequirementAnchorKey = (requirement: {
    document_sha256?: string;
    topic?: string;
    text: string;
    citations: Array<{ document_sha256: string; evidence_quote: string }>;
  }) => {
    const sourceText = normalizeEvidenceText(
      `${requirement.topic ?? ""} ${requirement.text} ${requirement.citations
        .map((citation) => citation.evidence_quote).join(" ")}`
    );
    const kind = [
      ["afr-registration", /\bapplication for registration\b.{0,80}\bafr\b/],
      ["organization-clearance", /\borganization security clearance\b/],
      ["designated-organization-screening", /\bdesignated organization screening\b.{0,40}\bdos\b/],
      ["personnel-reliability-status", /\bpersonnel\b.{0,180}\breliability status\b/]
    ].find(([, pattern]) => (pattern as RegExp).test(sourceText))?.[0];
    const documents = new Set(requirement.citations.map((citation) => citation.document_sha256));
    const documentSha256 = requirement.document_sha256 ??
      (documents.size === 1 ? [...documents][0] : null);
    return kind && documentSha256 ? `${documentSha256}:security:${kind}` : null;
  };
  const securityRequirementExactKey = (input: {
    document_sha256?: string;
    text: string;
    citations: Array<{ document_sha256: string }>;
  }) => {
    const documents = new Set(input.citations.map((citation) => citation.document_sha256));
    const documentSha256 = input.document_sha256 ??
      (documents.size === 1 ? [...documents][0] : null);
    return documentSha256 && input.text.trim()
      ? `${documentSha256}:security-exact:${normalizeEvidenceText(input.text)}`
      : null;
  };
  const recoveredSecurityExactKeys = new Set(recoveredSecurityRequirements.flatMap(
    (requirement) => securityRequirementExactKey(requirement) ?? []
  ));
  const claimAnchorCollisions = input.draft.claims.filter((claim) =>
    recoveredClaimIds.has(claim.claim_id)
  ).length;
  const requirementAnchorCollisions = input.draft.requirements.filter((requirement) =>
    recoveredRequirementIds.has(requirement.id)
  ).length;
  let rejectedCitationCandidates = 0;
  let unsupportedItemsRemoved = claimAnchorCollisions + requirementAnchorCollisions;
  let truthReviewItems = claimAnchorCollisions + requirementAnchorCollisions;
  const draftClaims = [
    ...input.draft.claims.filter((claim) => !recoveredClaimIds.has(claim.claim_id)),
    ...recoveredClaims
  ];
  const draftRequirements = [
    ...input.draft.requirements.filter((requirement) => !recoveredRequirementIds.has(requirement.id)),
    ...recoveredRequirements
  ];
  const duplicateClaimIds = duplicateIds(draftClaims, (claim) => claim.claim_id);
  const duplicateRequirementIds = duplicateIds(draftRequirements, (requirement) => requirement.id);
  const duplicateEvaluationIds = duplicateIds(input.draft.evaluation.rules, (rule) => rule.id);
  const duplicateRiskIds = duplicateIds(input.draft.risks, (risk) => risk.id);
  const duplicateIdentityCount = duplicateClaimIds.size + duplicateRequirementIds.size +
    duplicateEvaluationIds.size + duplicateRiskIds.size;

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
    rejectedCitationCandidates += verified.receipts.filter((receipt) => !receipt.verified).length;
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
  for (const draftClaim of draftClaims) {
    const claim = canonicalizeTypedSourceClaim(draftClaim);
    if (duplicateClaimIds.has(claim.claim_id)) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      continue;
    }
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
    const sourceConsistent = Boolean(document && matchingCitations.length > 0 &&
      citationsMatchDocument(matchingCitations, claim.document_sha256));
    const scalarSupported = assertionTokensSupportedByCitations(claim.claim_text, matchingCitations);
    const proseSupported = proseAssertionSupportedByCitations(claim.claim_text, matchingCitations);
    const fieldBound = topicFieldBindingSupported(claim.topic, claim.claim_text, matchingCitations);
    const typedField = summaryFieldForAssertion(claim.topic, claim.claim_text);
    const proseOrTypedFieldSupported = proseSupported || Boolean(typedField && fieldBound);
    if (!sourceConsistent || !scalarSupported || !proseOrTypedFieldSupported || !fieldBound) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      if (claim.effect !== "delete" && matchingCitations.length > 0) {
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
    validClaimDrafts.push({ claim, citations: matchingCitations, document: document! });
  }

  const verifiedRecoveredSecurityKeys = new Set(validClaimDrafts.flatMap(({ claim }) =>
    recoveredClaimIds.has(claim.claim_id) ? securityAnchorKey(claim) ?? [] : []
  ));
  const verifiedRecoveredSummaryKeys = new Set(validClaimDrafts.flatMap(({ claim }) =>
    recoveredSummaryClaimIds.has(claim.claim_id) ? summaryAnchorKey(claim) ?? [] : []
  ));
  const reconciledClaimDrafts = validClaimDrafts.filter(({ claim }) =>
    !recoveredSecurityExactKeys.has(securityRequirementExactKey({
      document_sha256: claim.document_sha256,
      text: claim.claim_text,
      citations: claim.citations
    }) ?? "") && (
      recoveredClaimIds.has(claim.claim_id) ||
      (!verifiedRecoveredSecurityKeys.has(securityAnchorKey(claim) ?? "") &&
        !verifiedRecoveredSummaryKeys.has(summaryAnchorKey(claim) ?? ""))
    )
  );
  unsupportedItemsRemoved += validClaimDrafts.length - reconciledClaimDrafts.length;
  const visibleReviewClaims = reviewClaims.filter((claim) =>
    !recoveredSecurityExactKeys.has(securityRequirementExactKey({
      text: claim.claim_text,
      citations: claim.citations
    }) ?? "")
  );

  const claimReconciliation = reconcileVersionedFacts(reconciledClaimDrafts.map(({ claim, citations, document }) => ({
    id: claim.claim_id,
    topic: claim.topic,
    factKey: deriveDeadlineFactKey(claim.claim_text, citations) ?? deriveSourceFactKey({
      topic: claim.topic, value: claim.claim_text,
      documentSha256: claim.document_sha256, citations
    }) ?? undefined,
    factKeySource: "derived" as const,
    value: claim.claim_text,
    documentSha256: claim.document_sha256,
    documentRole: document.role,
    amendmentNumber: document.amendmentNumber,
    effect: claim.effect,
    citations,
    supersedesIds: claim.supersedes_claim_ids
  })));
  const unauthorizedClaimMutations = new Set(claimReconciliation.unauthorizedMutationIds);
  unsupportedItemsRemoved += unauthorizedClaimMutations.size;
  truthReviewItems += unauthorizedClaimMutations.size;
  const claims: AnalysisResult["claims"] = [
    ...claimReconciliation.facts.flatMap((fact) => {
      const draft = reconciledClaimDrafts.find((item) => item.claim.claim_id === fact.id)?.claim;
      if (!draft || draft.effect === "delete") return [];
      return [{
        claim_id: fact.id,
        claim_text: fact.value,
        claim_type: fact.status === "conflicted" && !unauthorizedClaimMutations.has(fact.id)
          ? "conflict" as const : draft.claim_type,
        status: unauthorizedClaimMutations.has(fact.id) ? "needs_review" as const : fact.status,
        confidence: draft.confidence,
        citations: fact.citations,
        formula_and_inputs: null
      }];
    }),
    ...visibleReviewClaims
  ];

  const validRequirementDrafts: Array<{
    requirement: DraftAnalysis["requirements"][number]; citations: Citation[];
    document: MaterializeInput["documents"][number];
    category: DraftAnalysis["requirements"][number]["category"];
  }> = [];
  const reviewRequirements: AnalysisResult["requirements"] = [];
  for (const requirement of draftRequirements) {
    if (duplicateRequirementIds.has(requirement.id)) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      continue;
    }
    // A cross-reference such as "mandatory criteria are included in Annex D"
    // locates the real criteria; it is not itself an individual obligation.
    if (requirement.category === "mandatory" && isMandatoryLocationReference(requirement.text)) {
      unsupportedItemsRemoved += 1;
      continue;
    }
    const checked = verify(requirement.citations);
    const matchingCitations = checked.citations.filter(
      (citation) => citation.document_sha256 === requirement.document_sha256
    );
    const document = input.documents.find(
      (item) => item.index.documentSha256 === requirement.document_sha256
    );
    const sourceMarksMandatory = mandatoryCategorySupported(requirement.text, matchingCitations);
    const supported = Boolean(document && matchingCitations.length > 0 &&
      citationsMatchDocument(matchingCitations, requirement.document_sha256) &&
      assertionTokensSupportedByCitations(requirement.text, matchingCitations) &&
      proseAssertionSupportedByCitations(requirement.text, matchingCitations) &&
      topicFieldBindingSupported(requirement.topic, requirement.text, matchingCitations) &&
      (requirement.effect === "delete" || requirement.category !== "mandatory" || sourceMarksMandatory));
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
    validRequirementDrafts.push({
      requirement,
      citations: matchingCitations,
      document: document!,
      category: recoveredSecurityRequirementIds.has(requirement.id)
        ? "security"
        : sourceMarksMandatory ? "mandatory" : requirement.category
    });
  }
  const verifiedRecoveredMandatoryKeys = new Set(validRequirementDrafts.flatMap(({ requirement }) =>
    recoveredRequirementIds.has(requirement.id) ? mandatoryAnchorKey(requirement) ?? [] : []
  ));
  const verifiedRecoveredSecurityRequirementKeys = new Set(validRequirementDrafts.flatMap(
    ({ requirement }) => recoveredSecurityRequirementIds.has(requirement.id)
      ? securityRequirementAnchorKey(requirement) ?? []
      : []
  ));
  const reconciledRequirementDrafts = validRequirementDrafts.filter(({ requirement }) =>
    recoveredRequirementIds.has(requirement.id) ||
    (!verifiedRecoveredMandatoryKeys.has(mandatoryAnchorKey(requirement) ?? "") &&
      !verifiedRecoveredSecurityRequirementKeys.has(
        securityRequirementAnchorKey(requirement) ?? ""
      ))
  );
  unsupportedItemsRemoved += validRequirementDrafts.length - reconciledRequirementDrafts.length;
  const visibleReviewRequirements = reviewRequirements.filter((requirement) => {
    if (verifiedRecoveredSecurityRequirementKeys.has(
      securityRequirementAnchorKey(requirement) ?? ""
    )) return false;
    if (requirement.category !== "mandatory") return true;
    const labels = new Set(requirement.citations.flatMap((citation) => {
      const normalized = normalizeEvidenceText(citation.section ?? "");
      return /^m\d{1,3}$/.test(normalized) ? [normalized] : [];
    }));
    const documents = new Set(requirement.citations.map((citation) => citation.document_sha256));
    const key = labels.size === 1 && documents.size === 1
      ? `${[...documents][0]}:${[...labels][0]}`
      : null;
    return !key || !verifiedRecoveredMandatoryKeys.has(key);
  });
  const requirementReconciliation = reconcileVersionedFacts(reconciledRequirementDrafts.map(
    ({ requirement, citations, document }) => {
      const recoveredLabel = recoveredRequirementIds.has(requirement.id)
        ? citations.map((citation) => citation.section).find((section) => /^M\d{1,3}$/i.test(section ?? ""))
        : null;
      const recoveredSecurityKey = recoveredSecurityRequirementIds.has(requirement.id)
        ? securityRequirementAnchorKey(requirement)
        : null;
      return {
        id: requirement.id,
        topic: requirement.topic,
        factKey: recoveredLabel
          ? `document:${requirement.document_sha256}:mandatory:${recoveredLabel.toLowerCase()}`
          : recoveredSecurityKey
            ? `document:${recoveredSecurityKey}`
          : deriveDeadlineFactKey(requirement.text, citations) ?? deriveSourceFactKey({
            topic: requirement.topic, value: requirement.text,
            documentSha256: requirement.document_sha256, citations
          }) ?? undefined,
        factKeySource: recoveredLabel || recoveredSecurityKey
          ? "validated" as const
          : "derived" as const,
        value: requirement.text,
        documentSha256: requirement.document_sha256,
        documentRole: document.role,
        amendmentNumber: document.amendmentNumber,
        effect: requirement.effect,
        citations
      };
    }
  ));
  const unauthorizedRequirementMutations = new Set(requirementReconciliation.unauthorizedMutationIds);
  unsupportedItemsRemoved += unauthorizedRequirementMutations.size;
  truthReviewItems += unauthorizedRequirementMutations.size;
  const requirements: AnalysisResult["requirements"] = [
    ...requirementReconciliation.facts.flatMap((fact) => {
      const validated = reconciledRequirementDrafts.find((item) => item.requirement.id === fact.id);
      const draft = validated?.requirement;
      if (!draft || !validated || draft.effect === "delete") return [];
      return [{
        id: draft.id,
        category: validated.category,
        status: unauthorizedRequirementMutations.has(fact.id) ? "needs_review" as const : fact.status,
        text: fact.value,
        evidence_needed: sourceBackedSupportingDetail(draft.evidence_needed, fact.citations),
        consequence: sourceBackedSupportingDetail(draft.consequence, fact.citations),
        citations: fact.citations
      }];
    }),
    ...visibleReviewRequirements
  ];

  // Claims and requirements are presentation categories, not independent
  // truth stores. Reconcile them together so a duplicate fact cannot remain
  // current in one collection after an amendment supersedes it in the other.
  const packageSourceReconciliation = reconcileVersionedFacts([
    ...claimReconciliation.facts.map((fact) => ({
      ...fact, id: `claim:${fact.id}`
    })),
    ...requirementReconciliation.facts.map((fact) => ({
      ...fact, id: `requirement:${fact.id}`
    }))
  ]);
  unsupportedItemsRemoved -= unauthorizedClaimMutations.size + unauthorizedRequirementMutations.size;
  truthReviewItems -= unauthorizedClaimMutations.size + unauthorizedRequirementMutations.size;
  unsupportedItemsRemoved += packageSourceReconciliation.unauthorizedMutationIds.length;
  truthReviewItems += packageSourceReconciliation.unauthorizedMutationIds.length;
  const packageFactsById = new Map(packageSourceReconciliation.facts.map((fact) => [fact.id, fact]));
  const packageUnauthorized = new Set(packageSourceReconciliation.unauthorizedMutationIds);
  const effectiveClaimFacts = claimReconciliation.facts.map((fact) => ({
    ...fact,
    status: packageFactsById.get(`claim:${fact.id}`)?.status ?? fact.status
  }));
  const effectiveRequirementFacts = requirementReconciliation.facts.map((fact) => ({
    ...fact,
    status: packageFactsById.get(`requirement:${fact.id}`)?.status ?? fact.status
  }));
  for (const claim of claims) {
    const effective = packageFactsById.get(`claim:${claim.claim_id}`);
    if (!effective) continue;
    const unauthorized = packageUnauthorized.has(`claim:${claim.claim_id}`);
    claim.status = unauthorized ? "needs_review" : effective.status;
    const sourceDraft = reconciledClaimDrafts.find((item) => item.claim.claim_id === claim.claim_id)?.claim;
    if (sourceDraft) claim.claim_type = !unauthorized && effective.status === "conflicted"
      ? "conflict" : sourceDraft.claim_type;
  }
  for (const requirement of requirements) {
    const effective = packageFactsById.get(`requirement:${requirement.id}`);
    if (!effective) continue;
    requirement.status = packageUnauthorized.has(`requirement:${requirement.id}`)
      ? "needs_review" : effective.status;
  }

  const validEvaluationRules: Array<{
    rule: DraftAnalysis["evaluation"]["rules"][number]; citations: Citation[];
    document: MaterializeInput["documents"][number];
  }> = [];
  for (const rule of input.draft.evaluation.rules) {
    if (duplicateEvaluationIds.has(rule.id)) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      continue;
    }
    const checked = verify(rule.citations);
    const document = input.documents.find((item) => item.index.documentSha256 === rule.document_sha256);
    const matchingCitations = checked.citations.filter(
      (citation) => citation.document_sha256 === rule.document_sha256
    );
    const sourceConsistent = Boolean(document && matchingCitations.length > 0 &&
      citationsMatchDocument(matchingCitations, rule.document_sha256));
    const supportedCitations = sourceConsistent
      ? validatedEvaluationRule(rule.field, rule.value, matchingCitations)
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
      factKeySource: "validated" as const,
      value: rule.value,
      documentSha256: rule.document_sha256,
      documentRole: document.role,
      amendmentNumber: document.amendmentNumber,
      effect: rule.effect,
      citations
    })
  ));
  unsupportedItemsRemoved += evaluationReconciliation.unauthorizedMutationIds.length;
  truthReviewItems += evaluationReconciliation.unauthorizedMutationIds.length;
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
    if (duplicateRiskIds.has(risk.id)) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      continue;
    }
    const checked = verify(risk.citations);
    const document = input.documents.find((item) => item.index.documentSha256 === risk.document_sha256);
    const matchingCitations = checked.citations.filter(
      (citation) => citation.document_sha256 === risk.document_sha256
    );
    const supported = Boolean(document && matchingCitations.length > 0 &&
      citationsMatchDocument(matchingCitations, risk.document_sha256) &&
      proseAssertionSupportedByCitations(risk.finding, matchingCitations) &&
      topicFieldBindingSupported(risk.topic, risk.finding, matchingCitations) &&
      assertionTokensSupportedByCitations(
        `${risk.finding} ${risk.impact} ${risk.recommended_action}`,
        matchingCitations
      ));
    if (!supported) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      continue;
    }
    validRiskDrafts.push({ risk, citations: matchingCitations, document: document! });
  }
  const riskReconciliation = reconcileVersionedFacts(validRiskDrafts.map(({ risk, citations, document }) => {
    const lineage = resolveRiskLineage(risk.finding, citations, risk.document_sha256);
    return {
      id: risk.id,
      topic: risk.topic,
      // Bound risks reconcile only within the same server-derived lineage.
      // Unbound/ambiguous risks remain independent and cannot use a generic
      // model topic to delete or conflict with another finding.
      factKey: lineage.kind === "bound" ? `risk-lineage:${lineage.key}` : `risk-record:${risk.id}`,
      factKeySource: "validated" as const,
      value: risk.finding,
      documentSha256: risk.document_sha256,
      documentRole: document.role,
      amendmentNumber: document.amendmentNumber,
      effect: risk.effect,
      citations
    };
  }));
  unsupportedItemsRemoved += riskReconciliation.unauthorizedMutationIds.length;
  truthReviewItems += riskReconciliation.unauthorizedMutationIds.length;
  const allEffectiveSourceFacts = [
    ...effectiveClaimFacts,
    ...effectiveRequirementFacts,
    ...evaluationReconciliation.facts
  ];
  const conflictedSourceKeys = new Set(allEffectiveSourceFacts.flatMap((fact) =>
    fact.status === "conflicted" && fact.factKey ? [fact.factKey] : []
  ));
  const supersededSourceFacts = allEffectiveSourceFacts.filter((fact) =>
    fact.status === "superseded" && (!fact.factKey || !conflictedSourceKeys.has(fact.factKey))
  );
  const activeSourceFacts = allEffectiveSourceFacts.filter((fact) => fact.status === "active");
  let ambiguousRiskLineageCount = 0;
  const risks: AnalysisResult["risks"] = riskReconciliation.facts.flatMap((fact) => {
    const draft = validRiskDrafts.find((item) => item.risk.id === fact.id)?.risk;
    if (!draft || draft.effect === "delete" || fact.status !== "active") return [];
    const staleDispositions = supersededSourceFacts.map((sourceFact) =>
      riskSemanticallyDependsOnSupersededFact({
        ...fact,
        finding: draft.finding,
        impact: draft.impact,
        recommendedAction: draft.recommended_action
      }, sourceFact, sourceFact.factKey
        ? activeSourceFacts.filter((candidate) => candidate.factKey === sourceFact.factKey)
          .map((candidate) => candidate.value)
        : [])
    );
    if (staleDispositions.includes("stale") || staleDispositions.includes("mixed")) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      if (staleDispositions.includes("mixed")) ambiguousRiskLineageCount += 1;
      return [];
    }
    if (staleDispositions.includes("ambiguous")) {
      ambiguousRiskLineageCount += 1;
      truthReviewItems += 1;
    }
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
    ...packageSourceReconciliation.conflicts,
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
  if (ambiguousRiskLineageCount > 0) {
    blockingUnknowns.push(
      "One or more risks share a superseded scalar but have ambiguous source lineage and require review."
    );
  }
  if (duplicateIdentityCount > 0) {
    blockingUnknowns.push("One or more model records reused an ambiguous identity and were withheld.");
  }
  if (conflicts.length > 0) {
    blockingUnknowns.push("The supplied package contains unresolved source conflicts.");
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

  const activeClaimSources = effectiveClaimFacts.flatMap((fact) => {
    if (fact.status !== "active") return [];
    const draft = reconciledClaimDrafts.find((item) => item.claim.claim_id === fact.id)?.claim;
    return draft ? [{ id: fact.id, topic: draft.topic, value: fact.value, citations: fact.citations }] : [];
  });
  const uniqueSourceSummaryValue = (field: SummaryField) => {
    // Do not authorize this fallback from the model-controlled topic. The
    // scalar fields that call it have field-specific source-relation checks
    // (cover labels, closing relation, or whole-bid channel), while overview
    // and scope use only server-owned Summary anchors below.
    const candidates = activeClaimSources.flatMap((source) =>
      source.citations.some((citation) => citationSupportsSummaryValue(field, source.value, citation))
        ? [source.value]
        : []
    );
    const unique = new Map<string, string>();
    for (const candidate of candidates) {
      unique.set(normalizeEvidenceText(candidate), candidate);
    }
    return unique.size === 1 ? [...unique.values()][0] : null;
  };
  const sourceSupportsSummary = (field: keyof typeof SUMMARY_TOPIC_PATTERNS, value: string | null) => {
    if (value === null) return false;
    const normalized = normalizeEvidenceText(value);
    if (field === "current_selection_method") return Boolean(
      evaluationValues.selection_method &&
      normalizeEvidenceText(evaluationValues.selection_method) === normalized &&
      uniqueEvaluationCitations.some((citation) => citationSupportsSummaryValue(field, value, citation))
    );
    return activeClaimSources.some((source) =>
      SUMMARY_TOPIC_PATTERNS[field].test(source.topic) && normalizeEvidenceText(source.value) === normalized &&
      source.citations.some((citation) => citationSupportsSummaryValue(field, value, citation))
    );
  };
  const supportedOrUniqueSource = (field: SummaryField, preferred: string | null) =>
    sourceSupportsSummary(field, preferred) ? preferred : uniqueSourceSummaryValue(field);
  const recoveredActiveSummaryValues = (topic: "overview" | "scope") => {
    const unique = new Map<string, string>();
    for (const source of activeClaimSources) {
      if (!recoveredSummaryClaimIds.has(source.id) || source.topic !== topic ||
        source.citations.length === 0 || source.citations.some((citation) => !citation.verified)) continue;
      unique.set(normalizeEvidenceText(source.value), source.value);
    }
    return [...unique.values()];
  };
  const recoveredOverviewValues = recoveredActiveSummaryValues("overview");
  const recoveredScopeValues = recoveredActiveSummaryValues("scope");
  const safeTitle = supportedOrUniqueSource("title", input.draft.summary.title)
    ?? "Document-only RFP analysis";
  const sourceBackedOverview = recoveredOverviewValues.length === 1
    ? recoveredOverviewValues[0]
    : sourceSupportsSummary("overview", input.draft.summary.overview)
      ? input.draft.summary.overview
      : null;
  const usedTitleAsOverviewFallback = sourceBackedOverview === null &&
    safeTitle !== "Document-only RFP analysis";

  const activeSubmissionRequirements = requirements.filter((requirement) =>
    requirement.status === "active" && requirement.category === "submission"
  );
  const preferredSubmission = supportedOrUniqueSource(
    "submission_method",
    input.draft.summary.submission_method
  );
  const submissionLabels: Record<SubmissionMethodSignature, string> = {
    email: "Email",
    portal: "Portal",
    electronic: "Electronic submission",
    fax: "Fax",
    postal_mail: "Postal mail",
    courier: "Courier",
    hand_delivery: "Hand delivery"
  };
  const submissionCandidates = new Map<SubmissionMethodSignature, {
    citations: Citation[];
    requirementIds: Set<string>;
  }>();
  let ambiguousSubmissionRecoveryEvidence = false;
  const recordSubmissionEvidence = (citation: Citation, requirementId?: string) => {
    if (!citation.verified) return;
    const relationSignatures = new Set(submissionRelationClauses(citation)
      .flatMap((clause) => [...submissionMethodSignatures(clause)]));
    if (relationSignatures.size > 1) {
      // One verified citation affirmatively authorizes several whole-bid
      // channels. Ignoring it could make a different single-channel quote
      // look package-wide unique, so disable summary publication altogether.
      ambiguousSubmissionRecoveryEvidence = true;
      return;
    }
    if (relationSignatures.size !== 1) return;
    const signature = [...relationSignatures][0];
    if (!citationSupportsSubmissionMethod(submissionLabels[signature], citation)) return;
    const existing = submissionCandidates.get(signature);
    submissionCandidates.set(signature, {
      citations: deduplicateCitations([...(existing?.citations ?? []), citation]),
      requirementIds: new Set([
        ...(existing?.requirementIds ?? []),
        ...(requirementId ? [requirementId] : [])
      ])
    });
  };
  for (const requirement of activeSubmissionRequirements) {
    for (const citation of requirement.citations) recordSubmissionEvidence(citation, requirement.id);
  }
  // A model summary claim can be the only publishable whole-bid evidence in a
  // small document. Include its independently verified citation in the same
  // package-wide uniqueness gate, but never grant authority from its topic.
  for (const source of activeClaimSources) {
    for (const citation of source.citations) recordSubmissionEvidence(citation);
  }
  const recoveredSubmission = !ambiguousSubmissionRecoveryEvidence && submissionCandidates.size === 1
    ? [...submissionCandidates.entries()][0]
    : null;
  const preferredSubmissionSignatures = preferredSubmission
    ? submissionMethodSignatures(preferredSubmission)
    : new Set<SubmissionMethodSignature>();
  const preferredSubmissionMatchesPackage = Boolean(
    preferredSubmission && recoveredSubmission && preferredSubmissionSignatures.size === 1 &&
    preferredSubmissionSignatures.has(recoveredSubmission[0])
  );
  if (!preferredSubmission && recoveredSubmission && recoveredSubmission[1].requirementIds.size > 0) {
    const [signature, evidence] = recoveredSubmission;
    let claimId = `server-derived-submission-method-${signature}`;
    while (claims.some((claim) => claim.claim_id === claimId)) claimId += "-verified";
    claims.push({
      claim_id: claimId,
      claim_text: submissionLabels[signature],
      claim_type: "derived",
      status: "active",
      confidence: 1,
      citations: evidence.citations,
      formula_and_inputs: {
        formula: "unique affirmative whole-bid submission channel in active verified submission requirements",
        inputs: {
          channel: signature,
          source_requirement_ids: [...evidence.requirementIds].sort().join(",")
        }
      }
    });
  }
  const safeSummary = {
    title: safeTitle,
    solicitation_number: supportedOrUniqueSource(
      "solicitation_number",
      input.draft.summary.solicitation_number
    ),
    issuer: supportedOrUniqueSource("issuer", input.draft.summary.issuer),
    closing_date: supportedOrUniqueSource("closing_date", input.draft.summary.closing_date),
    overview: sourceBackedOverview ?? safeTitle,
    scope: [...new Map([
      ...input.draft.summary.scope
        .filter((item) => sourceSupportsSummary("scope", item))
        .map((item) => [normalizeEvidenceText(item), item] as const),
      ...recoveredScopeValues.map((item) => [normalizeEvidenceText(item), item] as const)
    ]).values()],
    submission_method: preferredSubmissionMatchesPackage
      ? preferredSubmission
      : !preferredSubmission && recoveredSubmission && recoveredSubmission[1].requirementIds.size > 0
        ? submissionLabels[recoveredSubmission[0]]
        : null,
    current_selection_method: sourceSupportsSummary(
      "current_selection_method",
      input.draft.summary.current_selection_method
    )
      ? input.draft.summary.current_selection_method
      : evaluationValues.selection_method
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
  // Measure the one population the user can actually inspect. Rejected model
  // candidates are disclosed by unsupported_items_removed; counting them in
  // this denominator while counting only published items in the numerator
  // would turn successful fail-closed filtering into a false citation gap.
  // Keep this population aligned with the release verifier's visible groups.
  const criticalCitationGroups = [
    ...claims.filter((claim) => claim.claim_type !== "unknown").map((claim) => claim.citations),
    ...requirements.map((requirement) => requirement.citations),
    uniqueEvaluationCitations,
    ...risks.map((risk) => risk.citations),
    ...conflicts.map((conflict) => conflict.citations)
  ];
  const criticalClaims = criticalCitationGroups.length;
  const criticalClaimsCited = criticalCitationGroups.filter((citations) =>
    citations.length > 0 && citations.every((citation) =>
      citation.verified && citation.pdf_page_1based !== null
    )
  ).length;
  const actualMicroUsd = input.costs.reduce((total, event) => total + (event.actual_micro_usd ?? 0), 0);
  const estimatedMicroUsd = input.costs.reduce(
    (total, event) => total + (event.actual_micro_usd === null ? event.estimated_micro_usd ?? 0 : 0),
    0
  );
  const pricedProviders = new Set(input.costs.flatMap((event) =>
    event.actual_micro_usd !== null || event.estimated_micro_usd !== null
      ? [event.provider]
      : []
  ));
  const selectedStorageProvider = input.storageProvider === undefined
    ? "railway_s3"
    : input.storageProvider;
  const expectedCostProviders = [
    "monid",
    "openai",
    "vercel",
    "neon",
    ...(selectedStorageProvider ? [selectedStorageProvider] : [])
  ] as const;
  const unpricedProviders = expectedCostProviders.filter((provider) => {
    if (!pricedProviders.has(provider)) return true;
    if (provider === "vercel" || provider === "neon" || provider === "railway_s3") {
      return !hasCompleteInfrastructureCostCoverage(input.costs, provider);
    }
    return false;
  });
  const notApplicableProviders = (["railway_s3", "vercel_blob"] as const)
    .filter((provider) => provider !== selectedStorageProvider);
  const knownSubtotalMicroUsd = actualMicroUsd + estimatedMicroUsd;

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
      critical_claims_cited: criticalClaimsCited,
      citations_verified: allVisibleCitations.filter((citation) => citation.verified).length,
      unsupported_items_removed: unsupportedItemsRemoved,
      search_events: 0,
      follow_embedded_link_events: 0,
      warnings: [
        "Analysis is restricted to the supplied documents.",
        "Context.dev zero-data retention is not enabled; an upstream artifact expiry of seven days was observed in the release contract spike.",
        ...(usedTitleAsOverviewFallback
          ? ["No independently source-backed overview was extracted; the verified solicitation title is shown as the subject."]
          : []),
        ...(rejectedCitationCandidates > 0
          ? [`${rejectedCitationCandidates} model-supplied citation candidate(s) could not be independently located and were omitted.`]
          : [])
      ]
    },
    costs: {
      currency: "USD",
      events: input.costs,
      completeness: unpricedProviders.length === 0 ? "complete" : "partial",
      unpriced_providers: unpricedProviders,
      not_applicable_providers: notApplicableProviders,
      actual_micro_usd: actualMicroUsd,
      estimated_micro_usd: estimatedMicroUsd,
      known_subtotal_micro_usd: knownSubtotalMicroUsd,
      total_micro_usd: knownSubtotalMicroUsd,
      includes_failed_attempts: input.costs.some((event) => event.status === "failed")
    },
    generated_at: generatedAt.toISOString(),
    expires_at: input.expiresAt.toISOString()
  };
  return { result: AnalysisResultSchema.parse(result), receipts };
}
