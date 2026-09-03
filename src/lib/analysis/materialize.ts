import {
  AnalysisResultSchema,
  type AnalysisResult,
  type Citation,
  type CostEvent,
  type DocumentManifest
} from "@/contracts";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import { deriveDeadlineFactKey, reconcileVersionedFacts } from "@/lib/analysis/reconciliation";
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

function citationsDescribeSameSourceFact(left: Citation, right: Citation) {
  if (
    left.document_sha256 !== right.document_sha256 ||
    left.pdf_page_1based === null || left.pdf_page_1based !== right.pdf_page_1based
  ) return false;
  const leftQuote = normalizeEvidenceText(left.evidence_quote);
  const rightQuote = normalizeEvidenceText(right.evidence_quote);
  return leftQuote === rightQuote || leftQuote.includes(rightQuote) || rightQuote.includes(leftQuote);
}

function significantWords(value: string) {
  const ignored = new Set([
    "a", "an", "and", "are", "as", "at", "be", "been", "by", "for", "from", "has", "have",
    "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "will", "with"
  ]);
  return [...new Set(normalizeEvidenceText(value).match(/[a-z]{3,}/g)?.filter((word) => !ignored.has(word)) ?? [])];
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
  const normalizedEvidence = normalizeEvidenceText(citations.map((citation) => citation.evidence_quote).join(" "));
  if (normalizedAssertion.length >= 3 && normalizedEvidence.includes(normalizedAssertion)) return true;
  const words = significantWords(assertion);
  const evidenceWords = new Set(significantWords(normalizedEvidence));
  return words.length === 0 || words.every((word) => evidenceWords.has(word));
}

function semanticDependencyTokens(value: string) {
  const aliases = new Map([
    ["deadline", "closing"], ["due", "closing"], ["late", "closing"],
    ["bid", "submission"], ["bids", "submission"], ["bidder", "submission"],
    ["bidders", "submission"], ["proposal", "submission"], ["proposals", "submission"],
    ["tender", "submission"], ["term", "period"], ["duration", "period"]
  ]);
  return new Set(significantWords(value).map((word) => aliases.get(word) ?? word));
}

function riskSemanticallyDependsOnSupersededFact(
  risk: { topic: string; value: string; documentSha256: string; citations: Citation[] },
  superseded: {
    topic: string; factKey?: string; value: string; documentSha256: string; citations: Citation[];
  },
  currentValues: string[]
) {
  if (risk.documentSha256 !== superseded.documentSha256) return false;
  if (risk.citations.some((riskCitation) => superseded.citations.some((sourceCitation) =>
    citationsDescribeSameSourceFact(riskCitation, sourceCitation)))) return true;

  const riskObjectiveTokens = extractAssertionTokens(risk.value);
  const sourceObjectiveTokens = extractAssertionTokens(superseded.value);
  if (riskObjectiveTokens.size === 0 || sourceObjectiveTokens.size === 0) return false;
  const currentObjectiveTokens = new Set(currentValues.flatMap((value) => [...extractAssertionTokens(value)]));
  const invalidatedSourceTokens = currentValues.length > 0
    ? [...sourceObjectiveTokens].filter((token) => !currentObjectiveTokens.has(token))
    : [...sourceObjectiveTokens];
  const sharedObjectiveTokens = invalidatedSourceTokens.filter((token) => riskObjectiveTokens.has(token));
  if (sharedObjectiveTokens.length === 0) return false;

  // A risk that repeats the exact old date/time from a superseded temporal
  // fact is stale regardless of the model-provided risk topic. Requiring the
  // risk topic to agree would let topic drift preserve an obsolete deadline.
  const sourceContext = normalizeEvidenceText([
    superseded.topic,
    superseded.value,
    ...superseded.citations.map((citation) => citation.evidence_quote)
  ].join(" "));
  const sourceIsTemporal = superseded.factKey?.startsWith("deadline:") ||
    /\b(?:closing|deadline|due|date|time|term|period|expir(?:y|ation)|delivery|milestone|schedule)\b/.test(sourceContext);
  const sourceDeadlineKey = superseded.factKey?.startsWith("deadline:") ? superseded.factKey : null;
  const riskDeadlineKey = deriveDeadlineFactKey(risk.value, risk.citations);
  if (sourceDeadlineKey && riskDeadlineKey && sourceDeadlineKey !== riskDeadlineKey) return false;
  if (sourceIsTemporal && sharedObjectiveTokens.some((token) =>
    /^(?:date|time|timezone|utc-offset):/.test(token)
  )) return true;

  const riskTopics = semanticDependencyTokens(`${risk.topic} ${risk.value}`);
  const sourceTopics = semanticDependencyTokens(`${superseded.topic} ${superseded.value}`);
  return [...riskTopics].some((token) => sourceTopics.has(token));
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

type SelectionMethodSignature =
  | "highest_combined_rating"
  | "lowest_evaluated_price"
  | "lowest_price"
  | "best_value"
  | "highest_score";

const SELECTION_METHOD_SOURCE =
  "(highest\\s+combined\\s+rating|lowest\\s+evaluated\\s+(?:total\\s+)?price|" +
  "lowest\\s+(?:total\\s+)?price|best\\s+value|highest\\s+(?:technical\\s+)?score)";

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
  const quote = normalizeEvidenceText(citation.evidence_quote);
  const relations = new Set<SelectionMethodSignature>();
  const withoutAnotherClause = "(?:(?![.;]|\\b(?:while|whereas|but)\\b).)";
  const forward = new RegExp(
    `\\b(?:award|selection|select(?:s|ed|ion)?|recommend(?:s|ed|ation)?)\\b` +
    `${withoutAnotherClause}{0,180}?\\b${SELECTION_METHOD_SOURCE}\\b`,
    "g"
  );
  const reverse = new RegExp(
    `\\b${SELECTION_METHOD_SOURCE}\\b${withoutAnotherClause}{0,180}?` +
    "\\b(?:will\\s+be\\s+(?:selected|recommended|awarded)|for\\s+award|basis\\s+of\\s+selection)\\b",
    "g"
  );
  for (const expression of [forward, reverse]) {
    for (const match of quote.matchAll(expression)) {
      const signature = selectionMethodSignature(match[1]);
      if (signature) relations.add(signature);
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
  return normalizeEvidenceText(citation.evidence_quote)
    .split(/(?<!a\.m)(?<!p\.m)\.\s+|[;,\n]+|\b(?:while|whereas|but)\b/)
    .map((clause) => clause.trim())
    .filter((clause) => {
      const explicitLabel = /\bsubmission (?:method|portal|instructions?)\b/.test(clause);
      const tenderSubject = /\b(?:bids?|proposals?|tenders?|offers?|responses?|submissions?)\b/.test(clause);
      const submitAction = /\b(?:submit(?:ted|ting|s)?|send|sent|upload(?:ed|ing|s)?|deliver(?:ed|ing|s)?|e-?mail(?:ed|ing|s)?|courier(?:ed|ing|s)?)\b/.test(clause);
      const unrelatedSubject = /\b(?:questions?|enquir(?:y|ies)|clarifications?|invoices?|payments?|billing)\b/.test(clause);
      return !unrelatedSubject && (explicitLabel || (tenderSubject && submitAction));
    });
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
  for (const match of quote.matchAll(labelThenNumber)) values.add(Number(match[1]));
  for (const match of quote.matchAll(numberThenLabel)) values.add(Number(match[1]));
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

  for (const match of quote.matchAll(minimumBefore)) minimums.add(Number(match[1]));
  for (const match of quote.matchAll(minimumAfter)) minimums.add(Number(match[1]));
  for (const match of quote.matchAll(requiredScore)) minimums.add(Number(match[1]));
  for (const match of quote.matchAll(fraction)) {
    minimums.add(Number(match[1]));
    scales.add(Number(match[2]));
  }
  for (const match of quote.matchAll(outOf)) {
    minimums.add(Number(match[1]));
    scales.add(Number(match[2]));
  }
  for (const match of quote.matchAll(scaleOnly)) scales.add(Number(match[1]));
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
    if (normalizedValue === "true") return relevant;
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
    const boundCitations = relevant.filter((citation) => selectionRelationsInCitation(citation).has(expected));
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
type AnchoredSpan = { full: string; value: string };

const STRONG_FIELD_ANCHORS: ReadonlyArray<readonly [string, SummaryField | "question_deadline"]> = [
  ["\\b(?:rfp|tender|solicitation)\\s+(?:title|name)\\b", "title"],
  ["\\b(?:solicitation|tender|rfp|reference)\\s*(?:number|no\\.?|id)\\b", "solicitation_number"],
  ["\\b(?:issuer|buyer|contracting authority|department|agency)\\b", "issuer"],
  ["\\b(?:(?:solicitation|bid|tender)\\s+)?(?:closing date|closing time)|\\b(?:solicitation|bid|tender)\\s+close(?:s|d)?\\b|\\b(?:submission deadline|submission date|bid deadline|tender deadline|solicitation deadline)\\b", "closing_date"],
  ["\\b(?:questions?|enquir(?:y|ies)|clarifications?)\\b.{0,40}\\b(?:close|closes|closing|cut[ -]?off|deadline|due|received|submitted)\\b", "question_deadline"],
  ["\\bdeadline\\s+for\\s+(?:submitting\\s+)?(?:questions?|enquir(?:y|ies)|clarifications?)\\b", "question_deadline"],
  ["\\b(?:q\\s*&\\s*a|question(?:s)?[- ]and[- ]answer(?:s)?)\\s+(?:close|closing|cut[ -]?off|deadline|due)\\b", "question_deadline"],
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
      ? [{ full: quote, value: quote }]
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
    return [{ full: sourceSpan, value: rawValue }];
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
    return Boolean(expected && selectionRelationsInCitation(citation).has(expected) &&
      assertionTokensSupportedByCitations(value, [citation]) &&
      proseAssertionSupportedByCitations(value, [citation]));
  }
  const spans = anchoredFieldSpans(field, citation.evidence_quote);
  return spans.some((span) => {
    if (field === "closing_date") {
      if (/\b(?:questions?|enquir(?:y|ies)|clarifications?)\b/i.test(span.full)) return false;
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
    const scopedCitation = { ...citation, evidence_quote: span.full };
    if (!assertionTokensSupportedByCitations(value, [scopedCitation]) ||
      !proseAssertionSupportedByCitations(value, [scopedCitation])) return false;
    return ["title", "solicitation_number", "issuer"].includes(field)
      ? normalizeEvidenceText(value) === span.value
      : true;
  });
}

function topicFieldBindingSupported(topic: string, value: string, citations: Citation[]) {
  const field = (["title", "solicitation_number", "issuer", "closing_date", "submission_method",
    "current_selection_method"] as const)
    .find((candidate) => SUMMARY_TOPIC_PATTERNS[candidate].test(topic));
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

export function materializeAnalysis(input: MaterializeInput): {
  result: AnalysisResult;
  receipts: QuoteVerificationReceipt[];
} {
  const generatedAt = input.generatedAt ?? new Date();
  const receipts: QuoteVerificationReceipt[] = [];
  let unsupportedItemsRemoved = 0;
  let truthReviewItems = 0;
  const duplicateClaimIds = duplicateIds(input.draft.claims, (claim) => claim.claim_id);
  const duplicateRequirementIds = duplicateIds(input.draft.requirements, (requirement) => requirement.id);
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
    const sourceConsistent = Boolean(document && checked.everyCandidateVerified &&
      citationsMatchDocument(checked.citations, claim.document_sha256));
    const scalarSupported = assertionTokensSupportedByCitations(claim.claim_text, matchingCitations);
    const proseSupported = proseAssertionSupportedByCitations(claim.claim_text, matchingCitations);
    const fieldBound = topicFieldBindingSupported(claim.topic, claim.claim_text, matchingCitations);
    if (!sourceConsistent || !scalarSupported || !proseSupported || !fieldBound) {
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
    factKey: deriveDeadlineFactKey(claim.claim_text, citations) ?? undefined,
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
      const draft = validClaimDrafts.find((item) => item.claim.claim_id === fact.id)?.claim;
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
    ...reviewClaims
  ];

  const validRequirementDrafts: Array<{
    requirement: DraftAnalysis["requirements"][number]; citations: Citation[];
    document: MaterializeInput["documents"][number];
  }> = [];
  const reviewRequirements: AnalysisResult["requirements"] = [];
  for (const requirement of input.draft.requirements) {
    if (duplicateRequirementIds.has(requirement.id)) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      continue;
    }
    const checked = verify(requirement.citations);
    const matchingCitations = checked.citations.filter(
      (citation) => citation.document_sha256 === requirement.document_sha256
    );
    const document = input.documents.find(
      (item) => item.index.documentSha256 === requirement.document_sha256
    );
    const supported = Boolean(document && checked.everyCandidateVerified &&
      citationsMatchDocument(checked.citations, requirement.document_sha256) &&
      assertionTokensSupportedByCitations(requirement.text, matchingCitations) &&
      proseAssertionSupportedByCitations(requirement.text, matchingCitations) &&
      topicFieldBindingSupported(requirement.topic, requirement.text, matchingCitations));
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
      factKey: deriveDeadlineFactKey(requirement.text, citations) ?? undefined,
      value: requirement.text,
      documentSha256: requirement.document_sha256,
      documentRole: document.role,
      amendmentNumber: document.amendmentNumber,
      effect: requirement.effect,
      citations
    })
  ));
  const unauthorizedRequirementMutations = new Set(requirementReconciliation.unauthorizedMutationIds);
  unsupportedItemsRemoved += unauthorizedRequirementMutations.size;
  truthReviewItems += unauthorizedRequirementMutations.size;
  const requirements: AnalysisResult["requirements"] = [
    ...requirementReconciliation.facts.flatMap((fact) => {
      const draft = validRequirementDrafts.find((item) => item.requirement.id === fact.id)?.requirement;
      if (!draft || draft.effect === "delete") return [];
      return [{
        id: draft.id,
        category: draft.category,
        status: unauthorizedRequirementMutations.has(fact.id) ? "needs_review" as const : fact.status,
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
    if (duplicateEvaluationIds.has(rule.id)) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      continue;
    }
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
    const supported = Boolean(document && checked.everyCandidateVerified &&
      citationsMatchDocument(checked.citations, risk.document_sha256) &&
      proseAssertionSupportedByCitations(risk.finding, checked.citations) &&
      topicFieldBindingSupported(risk.topic, risk.finding, checked.citations) &&
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
  unsupportedItemsRemoved += riskReconciliation.unauthorizedMutationIds.length;
  truthReviewItems += riskReconciliation.unauthorizedMutationIds.length;
  const supersededSourceFacts = [
    ...claimReconciliation.facts,
    ...requirementReconciliation.facts,
    ...evaluationReconciliation.facts
  ].filter((fact) => fact.status === "superseded");
  const activeSourceFacts = [
    ...claimReconciliation.facts,
    ...requirementReconciliation.facts,
    ...evaluationReconciliation.facts
  ].filter((fact) => fact.status === "active");
  const risks: AnalysisResult["risks"] = riskReconciliation.facts.flatMap((fact) => {
    const draft = validRiskDrafts.find((item) => item.risk.id === fact.id)?.risk;
    if (!draft || draft.effect === "delete" || fact.status !== "active") return [];
    const dependsOnSupersededFact = supersededSourceFacts.some((sourceFact) =>
      riskSemanticallyDependsOnSupersededFact({
        ...fact,
        value: [draft.finding, draft.impact, draft.recommended_action].join(" ")
      }, sourceFact, sourceFact.factKey
        ? activeSourceFacts.filter((candidate) => candidate.factKey === sourceFact.factKey)
          .map((candidate) => candidate.value)
        : [])
    );
    if (dependsOnSupersededFact) {
      unsupportedItemsRemoved += 1;
      truthReviewItems += 1;
      return [];
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
  if (duplicateIdentityCount > 0) {
    blockingUnknowns.push("One or more model records reused an ambiguous identity and were withheld.");
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
    return draft ? [{ topic: draft.topic, value: fact.value, citations: fact.citations }] : [];
  });
  const sourceSupportsSummary = (field: keyof typeof SUMMARY_TOPIC_PATTERNS, value: string | null) => {
    if (value === null) return false;
    const normalized = normalizeEvidenceText(value);
    if (field === "current_selection_method") return Boolean(
      evaluationValues.selection_method &&
      normalizeEvidenceText(evaluationValues.selection_method) === normalized &&
      uniqueEvaluationCitations.some((citation) => citationSupportsSummaryValue(field, value, citation))
    );
    if (field === "scope" && requirements.some((requirement) =>
      requirement.status === "active" && normalizeEvidenceText(requirement.text) === normalized &&
      requirement.citations.some((citation) => citationSupportsSummaryValue(field, value, citation))
    )) return true;
    return activeClaimSources.some((source) =>
      SUMMARY_TOPIC_PATTERNS[field].test(source.topic) && normalizeEvidenceText(source.value) === normalized &&
      source.citations.some((citation) => citationSupportsSummaryValue(field, value, citation))
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
