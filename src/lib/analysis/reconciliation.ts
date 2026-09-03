import type { Citation, Conflict } from "@/contracts";
import { extractAssertionTokens } from "@/lib/evidence/citations";
import { normalizeEvidenceText } from "@/lib/pdf/page-index";

export interface VersionedFact {
  id: string;
  topic: string;
  /** A server-owned key may be supplied for closed taxonomies such as evaluation fields. */
  factKey?: string;
  /** How the server established factKey; model output never controls this flag. */
  factKeySource?: "derived" | "validated" | "fixture";
  value: string;
  documentSha256: string;
  documentRole: "base" | "amendment";
  amendmentNumber: string | null;
  effect: "add" | "replace" | "delete";
  citations: Citation[];
  supersedesIds?: string[];
}

export interface ReconciledFact extends VersionedFact {
  status: "active" | "superseded" | "conflicted";
}

const TOPIC_STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "clause", "controlling", "current", "for", "from",
  "in", "of", "original", "required", "requirement", "rule", "the", "to", "value"
]);
const TOPIC_SYNONYMS = new Map([
  ["deadline", "closing"], ["timestamp", "date"], ["due", "closing"],
  ["initial", "first"], ["term", "period"], ["ending", "end"], ["ends", "end"]
]);

function topicTokens(topic: string) {
  const normalized = normalizeEvidenceText(topic)
    .replace(/\bclosing\s+(?:date|timestamp|deadline)\b/g, "closing")
    .replace(/\bend\s+year\b/g, "horizon")
    .replace(/\bprojection[- ]horizon\b/g, "projection horizon");
  return [...new Set(
    normalized.match(/[\p{L}\p{N}]+/gu)?.map((token) => TOPIC_SYNONYMS.get(token) ?? token)
      .filter((token) => !TOPIC_STOP_WORDS.has(token)) ?? []
  )];
}

function normalizePolarityText(value: string) {
  return normalizeEvidenceText(value)
    .replace(/\bcan't\b/g, "cannot")
    .replace(/\bwon't\b/g, "will not")
    .replace(/\bain't\b/g, "is not")
    .replace(/\b(is|are|was|were|has|have|had|does|do|did|would|should|could|must|may|might)n't\b/g, "$1 not");
}

function sourceRelationSegments(fact: Pick<VersionedFact, "documentSha256" | "citations">) {
  return fact.citations
    .filter((citation) => citation.verified &&
      citation.document_sha256 === fact.documentSha256.toLowerCase())
    .flatMap((citation) => {
      const source = normalizeEvidenceText(citation.evidence_quote);
      const insuranceContext = /\binsurance\b/.test(source);
      const separator = insuranceContext
        ? /(?<!a\.m)(?<!p\.m)\.\s+|[;\n]+|\b(?:while|whereas|but|although|yet)\b|(?:,\s*|\s+)\band\s+(?=(?:insurance\s+)?(?:coverage\s+)?(?:contact|representative|attention|deductible|certificate|certification|coverage|limit|amount|liability|premium|fee|cost|payment|invoice|price|claim)\b)|,\s*(?=(?:insurance\s+)?(?:coverage\s+)?(?:contact|representative|attention|deductible|certificate|certification|coverage|limit|amount|liability|premium|fee|cost|payment|invoice|price|claim)\b)/i
        : /(?<!a\.m)(?<!p\.m)\.\s+|[;\n]+|\b(?:while|whereas|but|although|yet)\b/i;
      return source
        .split(separator)
        .map((segment) => {
          const trimmed = segment.trim();
          return insuranceContext &&
            !/\binsurance\b/.test(trimmed) &&
            /^(?:coverage\s+)?(?:contact|representative|attention|deductible|certificate|certification|coverage|limit|amount|liability|premium|fee|cost|payment|invoice|price|claim)\b/.test(trimmed)
            ? `insurance ${trimmed}` : trimmed;
        });
    })
    .map((segment) => segment.trim())
    .filter(Boolean);
}

const SOURCE_VALUE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "by", "for", "from", "has", "have",
  "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "will", "with"
]);

function sourceValueWords(value: string) {
  return [...new Set(normalizeEvidenceText(value).match(/[a-z]{3,}/g)
    ?.filter((word) => !SOURCE_VALUE_STOP_WORDS.has(word)) ?? [])];
}

function segmentSupportsFactValue(segment: string, value: string) {
  const normalizedValue = normalizeEvidenceText(value);
  if (normalizedValue.length >= 3 && segment.includes(normalizedValue)) return true;
  const assertedTokens = extractAssertionTokens(value);
  if (assertedTokens.size > 0) {
    const sourceTokens = extractAssertionTokens(segment);
    if (![...assertedTokens].every((token) => sourceTokens.has(token))) return false;
  }
  const words = sourceValueWords(value);
  const sourceWords = new Set(sourceValueWords(segment));
  return words.length === 0 ? assertedTokens.size > 0 : words.every((word) => sourceWords.has(word));
}

function positiveMutationTarget(value: string) {
  return value
    .split(/(?:,\s*|\s+|\(\s*)(?:and\s+)?(?:not|rather than|instead of|except(?: for)?|from|previously|formerly|old(?: value| limit| amount| date| time)?|prior(?: value| limit| amount| date| time)?|equivalent reference|reference(?: value| amount| only)?)\b/, 1)[0]
    .trim();
}

function explicitMutationTargetText(scope: string): string | null {
  const normalized = normalizePolarityText(scope);
  const targetStarts: number[] = [];
  const collectTargetStarts = (pattern: RegExp) => {
    for (const match of normalized.matchAll(pattern)) {
      if (match.index !== undefined) targetStarts.push(match.index + match[0].length);
    }
  };
  collectTargetStarts(/\b(?:amend(?:ed|s)?|chang(?:e|ed|es)|extend(?:ed|s)?|revis(?:e|ed|es)|updat(?:e|ed|es))\b[^.;]{0,100}?\b(?:to|until|through|into)\b\s*:?[\s-]*/g);
  collectTargetStarts(/\b(?:replac(?:e|ed|es)|substitut(?:e|ed|es))\b[^.;]{0,100}?\b(?:to|with|by)\b\s*:?[\s-]*/g);
  collectTargetStarts(/\b(?:increas(?:e|ed|es)|decreas(?:e|ed|es)|rais(?:e|ed|es)|reduc(?:e|ed|es)|restor(?:e|ed|es))\b[^.;]{0,100}?\b(?:to|into)\b\s*:?[\s-]*/g);
  const terminalTargetStart = targetStarts.toSorted((left, right) => left - right).at(-1);
  if (terminalTargetStart !== undefined) {
    const target = normalized.slice(terminalTargetStart);
    return positiveMutationTarget(target) || null;
  }
  const labeledNew = /\bnew\s+(?:value|limit|amount|date|time|deadline|ratio|weight|requirement)\s*(?:is|:|=)\s*(.+)$/.exec(normalized);
  if (labeledNew?.[1]) return positiveMutationTarget(labeledNew[1]) || null;
  const definitiveState = /\b(?:amended|revised|updated|replacement)\s+[a-z][a-z0-9&/()' -]{0,60}\s+(?:is|are|equals?)\s+(.+)$/.exec(normalized);
  if (definitiveState?.[1]) return positiveMutationTarget(definitiveState[1]) || null;
  const nowValue = /\bnow\b\s*:?[\s-]+(.+)$/.exec(normalized);
  return nowValue?.[1] ? positiveMutationTarget(nowValue[1]) || null : null;
}

function mutationTargetText(scope: string) {
  return explicitMutationTargetText(scope) ?? normalizePolarityText(scope);
}

function targetSupportsFactValue(target: string, value: string, allowDateOnly = false) {
  const assertedTokens = extractAssertionTokens(value);
  const targetTokens = extractAssertionTokens(target);
  if (assertedTokens.size > 0) {
    const valuesForKind = (tokens: Set<string>, kind: string) => new Set(
      [...tokens].filter((token) => token.startsWith(`${kind}:`))
    );
    // A generic subset check can splice an amount from one target tuple to
    // the currency or qualifier of another. When a target contains multiple
    // values of the same scalar kind, the assertion must account for the
    // complete set; otherwise the value role is ambiguous and fails closed.
    for (const kind of ["number", "percent", "currency", "magnitude", "date", "time", "timezone", "utc-offset", "bound"]) {
      const targetValues = valuesForKind(targetTokens, kind);
      if (targetValues.size <= 1) continue;
      const assertedValues = valuesForKind(assertedTokens, kind);
      if (assertedValues.size !== targetValues.size ||
        ![...targetValues].every((token) => assertedValues.has(token))) return false;
    }
    if ([...assertedTokens].every((token) => targetTokens.has(token))) return true;
    if (allowDateOnly) {
      const assertedDates = [...assertedTokens].filter((token) => token.startsWith("date:"));
      return assertedDates.length > 0 && assertedDates.every((token) => targetTokens.has(token));
    }
    return false;
  }
  return segmentSupportsFactValue(target, value);
}

function mutationScopeSupportsNewValue(scope: string, value: string, allowDateOnly = false) {
  const target = explicitMutationTargetText(scope);
  return Boolean(target && targetSupportsFactValue(target, value, allowDateOnly));
}

function terminalMutationTargetSupportsFact(fact: VersionedFact, allowDateOnly = false) {
  const targets = [...fact.citations]
    .sort((left, right) =>
      (left.pdf_page_1based ?? Number.MAX_SAFE_INTEGER) -
      (right.pdf_page_1based ?? Number.MAX_SAFE_INTEGER)
    )
    .flatMap((citation) => normalizePolarityText(citation.evidence_quote)
      .split(/(?<!a\.m)(?<!p\.m)\.\s+|[;\n]+/)
      .flatMap((scope) => {
        const target = explicitMutationTargetText(scope);
        return target ? [target] : [];
      }));
  const terminal = targets.at(-1);
  return Boolean(terminal && targetSupportsFactValue(terminal, fact.value, allowDateOnly));
}

function sourceKeyForSegment(segment: string, assertedValue = ""): string | null {
  if (/\bbasis of payment\b/.test(segment)) {
    const asserted = normalizeEvidenceText(assertedValue);
    if (/\b(?:payment )?currenc(?:y|ies)\b/.test(`${segment} ${asserted}`)) {
      return "document:basis-of-payment:payment-currency";
    }
    if (/\b(?:invoice|billing|payment) frequenc(?:y|ies)\b/.test(`${segment} ${asserted}`)) {
      return "document:basis-of-payment:invoice-frequency";
    }
    if (/\b(?:in its entirety|entire(?:ty)?|whole|complete(?:ly)?)\b/.test(segment) ||
      !/\b(?:currency|frequenc(?:y|ies)|rate|unit price|invoice|billing|tax|expense|travel)\b/.test(`${segment} ${asserted}`)) {
      return "document:basis-of-payment";
    }
    return null;
  }
  if (/\b(?:appendix\s*1|criterion\s*m3|m3)\b/.test(segment) &&
    /\b(?:compliance table|essential requirements|appendix)\b/.test(segment)) {
    const row = `${segment} ${normalizeEvidenceText(assertedValue)}`.match(
      /\b(?:row|item|criterion)\s*(?:m3[.:-]?)?0*(\d{1,3})\b/
    )?.[1];
    return row
      ? `document:m3-appendix-1:row:${row.padStart(2, "0")}`
      : "document:m3-appendix-1";
  }
  if (/\b(?:insurance|commercial general liability|professional liability|errors and omissions|e\s*&\s*o|cgl)\b/.test(segment)) {
    if (/\b(?:contact|representative|attention)\b/.test(segment)) return "insurance:contact";
    if (/\bdeductible\b/.test(segment)) return "insurance:deductible";
    if (/\bcertificat(?:e|ion)\b/.test(segment)) return "insurance:certificate";
    const nonCoverageObject = /\b(?:premium|fee|claim amount|claim value|claim cost|cost|payment|invoice|price)\b/.test(segment);
    const professional = /\b(?:professional liability|errors and omissions|e\s*&\s*o)\b/.test(segment);
    const cgl = /\b(?:commercial general liability|cgl)\b/.test(segment);
    if (nonCoverageObject && !/\b(?:coverage|policy limit|insured amount|liability coverage)\b/.test(segment)) {
      return null;
    }
    if (professional && cgl) {
      const asserted = normalizeEvidenceText(assertedValue);
      const assertedProfessional = /\b(?:professional liability|errors and omissions|e\s*&\s*o)\b/.test(asserted);
      const assertedCgl = /\b(?:commercial general liability|cgl)\b/.test(asserted);
      const scalarKinds = ["number:", "percent:", "currency:", "magnitude:"];
      const sourceTokens = extractAssertionTokens(segment);
      const hasAmbiguousValues = scalarKinds.some((prefix) =>
        [...sourceTokens].filter((token) => token.startsWith(prefix)).length > 1
      );
      if (!hasAmbiguousValues && assertedProfessional !== assertedCgl) {
        return assertedProfessional
          ? "insurance:professional-liability:coverage"
          : "insurance:cgl:coverage";
      }
      return null;
    }
    if (professional) {
      return "insurance:professional-liability:coverage";
    }
    if (cgl) {
      return "insurance:cgl:coverage";
    }
    if (/\b(?:coverage|policy limit|insured amount|liability coverage|insurance limit|insurance amount)\b/.test(segment)) {
      return "insurance:coverage";
    }
  }
  if (/\bcontract\b/.test(segment) &&
    !/\b(?:termination|contract)\s+(?:fee|notice|right|clause|cost|payment|damages?)\b/.test(segment) &&
    /\b(?:end date|expiry(?: date)?|expiration(?: date)?|termination date|period ends?|contract term)\b/.test(segment)) {
    return "contract:end";
  }
  if (/\b(?:projection|projections|forecast|forecasts)\b/.test(segment) &&
    !/\b(?:payment|invoice|contract|service term|delivery|fee|price|cost)\b/.test(segment) &&
    /\b(?:horizon|end year|endpoint|projection period|forecast period|years? (?:out|beyond))\b/.test(segment)) {
    return "projection:horizon";
  }
  return null;
}

/**
 * Closed, server-owned identities for destructive reconciliation. The key is
 * classified only from a verified source relation span. The asserted value is
 * used only to select its supporting span; neither model topic nor value can
 * manufacture a key. Ambiguous wide citations remain fail-closed.
 */
export function deriveSourceFactKey(fact: Pick<VersionedFact,
  "topic" | "value" | "documentSha256" | "citations">): string | null {
  const sourceSegments = sourceRelationSegments(fact);
  if (sourceSegments.length === 0) return null;
  const topic = normalizeEvidenceText(fact.topic);
  if (/\b(?:row|table)\b/.test(topic) &&
    !sourceSegments.some((segment) => /\b(?:appendix\s*1|criterion\s*m3|m3)\b/.test(segment) &&
      /\b(?:table|appendix)\b/.test(segment))) return null;
  const keys = new Set(sourceSegments
    .filter((segment) => segmentSupportsFactValue(segment, fact.value))
    .map((segment) => sourceKeyForSegment(segment, fact.value))
    .filter((key): key is string => key !== null));
  return keys.size === 1 ? [...keys][0] : null;
}

function closedFactIdentity(fact: VersionedFact): string | null {
  if (fact.factKey) return `owned:${normalizeEvidenceText(fact.factKey)}`;
  const deadlineKey = sourceDeadlineFactKey(fact);
  if (deadlineKey) return deadlineKey;
  const sourceKey = deriveSourceFactKey(fact);
  if (sourceKey) return `derived:${sourceKey}`;
  return null;
}

function canonicalTopicKey(fact: VersionedFact) {
  const identity = closedFactIdentity(fact);
  if (identity) return identity;
  const semanticText = normalizeEvidenceText([
    fact.topic,
    ...fact.citations.map((citation) => citation.evidence_quote)
  ].join(" "));
  if (
    !/\b(?:row|table)\b/.test(normalizeEvidenceText(fact.topic)) &&
    /\b(projection|projections|forecast|forecasts)\b/.test(semanticText) &&
    /\b(horizon|end year|endpoint|extend|extends|through|until|out from|to 20\d{2})\b/.test(semanticText)
  ) {
    return "derived:projection-horizon";
  }
  return topicTokens(fact.topic).toSorted().join(":");
}

export function deriveDeadlineFactKey(value: string, citations: Citation[]): string | null {
  const classify = (input: string): "deadline:questions" | "deadline:solicitation" | null => {
    const sourceText = normalizeEvidenceText(input);
    const questionSubject = "(?:questions?|enquir(?:y|ies)|clarifications?|requests? for clarification|q\\s*(?:&|and)\\s*a|question(?:s)?[- ]and[- ]answer(?:s)?)";
    const questionScope = new RegExp(
      `\\b${questionSubject}\\s+(?:(?:must|shall)\\s+be\\s+|(?:is|are)\\s+)?` +
      "(?:close(?:s|d)?|closing|cut[ -]?off|deadline|due|received|submitted)\\b"
    ).test(sourceText) || new RegExp(
      `\\b${questionSubject}\\s+(?:closing (?:date|time)|cut[ -]?off|deadline|due date)\\b`
    ).test(sourceText) || new RegExp(
      `\\b(?:closing (?:date|time)|cut[ -]?off|deadline)\\s+(?:for|to)\\s+` +
      `(?:submitting\\s+)?${questionSubject}\\b`
    ).test(sourceText);
    if (questionScope) return "deadline:questions";
    const explicitClosing = /\b(?:closing date|closing time|submission deadline|submission date|bid deadline|tender deadline|solicitation deadline)\b/.test(sourceText);
    const submissionTiming = /\b(?:solicitation|bid|bids|proposal|proposals|tender|offer|offers|submission)\s+(?:(?:must|shall)\s+be\s+|(?:is|are)\s+)?(?:received|submitted|due|close(?:s|d)?|closing)\b/.test(sourceText) ||
      /\b(?:deadline|closing (?:date|time)|due date)\s+(?:for|to)\s+(?:submitting\s+)?(?:bids?|proposals?|tenders?|offers?|submissions?)\b/.test(sourceText) ||
      /\b(?:late bids?|bids? received after|submissions? after|submit before)\b/.test(sourceText);
    return explicitClosing || submissionTiming ? "deadline:solicitation" : null;
  };
  // The value and topic are model-controlled. Scope must come from one
  // verified source clause that also contains every objective value token;
  // otherwise an adjacent "solicitation" or "questions" sentence could be
  // borrowed to authorize the wrong deadline chain.
  const assertedTokens = extractAssertionTokens(value);
  if (assertedTokens.size === 0) return null;
  const assertedScope = classify(value);
  const supportedScopes = new Set(citations.flatMap((citation) =>
    deadlineRelationSegments(citation.evidence_quote)
      .flatMap((clause) => {
        const scope = classify(clause);
        if (!scope) return [];
        if (assertedScope && scope !== assertedScope) return [];
        const evidenceTokens = extractAssertionTokens(clause);
        const hasMultipleTupleValues = ["date:", "time:", "timezone:", "utc-offset:"]
          .some((prefix) => new Set([...evidenceTokens].filter((token) => token.startsWith(prefix))).size > 1);
        if (hasMultipleTupleValues) {
          const targetTokens = extractAssertionTokens(mutationTargetText(clause));
          const assertedTupleTokens = [...assertedTokens].filter((token) =>
            /^(?:date|time|timezone|utc-offset):/.test(token)
          );
          const explicitlyRoleBound = /\bfrom\b.+\b(?:to|until|through)\b/.test(clause) &&
            assertedTupleTokens.length > 0 &&
            assertedTupleTokens.every((token) => targetTokens.has(token));
          if (!explicitlyRoleBound) return [];
        }
        return [...assertedTokens].every((token) => evidenceTokens.has(token)) ? [scope] : [];
      })
  ));
  return supportedScopes.size === 1 ? [...supportedScopes][0] : null;
}

function deadlineRelationSegments(input: string) {
  return input
    .split(/(?<!a\.m)(?<!p\.m)\.\s+|[;\n]+/i)
    .flatMap((part) => normalizeEvidenceText(part).split(
      /\b(?:while|whereas|but|although|yet)\b|(?:,\s*|\s+and\s+|\s+(?:(?:together|along)\s+)?with\s+|\s+as\s+well\s+as\s+|\s*-\s*|:\s*|\(\s*)(?=(?:(?:while|whereas|but|and|although|yet|with)\s+)?(?:the\s+)?(?:(?:all|written|bidder|vendor|supplier|offeror|prospective)\s+)*(?:solicitation|bids?|proposals?|tenders?|offers?|submissions?|questions?|enquir(?:y|ies)|clarifications?|q\s*(?:&|and)\s*a)\b)/
    ))
    .map((part) => part.trim())
    .filter(Boolean);
}

function sourceDeadlineFactKey(fact: VersionedFact): string | null {
  const key = deriveDeadlineFactKey(fact.value, fact.citations);
  return key ? `derived:${key}` : null;
}

function hasVerifiedCitations(fact: VersionedFact) {
  return fact.citations.length > 0 && fact.citations.every(
    (citation) => citation.verified && citation.pdf_page_1based !== null &&
      citation.document_sha256 === fact.documentSha256.toLowerCase()
  );
}

const REPLACE_ACTION = /\b(?:amend(?:ed|s)?|replace(?:s|d)?|substitut(?:e|ed|es)|revis(?:e|ed|es)|chang(?:e|ed|es)|extend(?:s|ed)?|updat(?:e|ed|es)|supersed(?:e|ed|es)|increas(?:e|ed|es)|decreas(?:e|ed|es)|rais(?:e|ed|es)|reduc(?:e|ed|es))\b/;
const DELETE_ACTION = /\b(?:delete(?:d|s)?|remove(?:d|s)?|strike|stricken|cancel(?:led|ed|s)?|no longer applies)\b/;

function evidenceClauses(fact: VersionedFact) {
  return fact.citations.flatMap((citation) =>
    normalizeEvidenceText(citation.evidence_quote)
      .split(/(?<!a\.m)(?<!p\.m)\.\s+|[;\n]+/)
      .map((clause) => clause.trim())
      .filter(Boolean)
  );
}

function mutationClauses(fact: VersionedFact) {
  const action = fact.effect === "delete" ? DELETE_ACTION : REPLACE_ACTION;
  return evidenceClauses(fact).filter((clause) => action.test(clause));
}

const INVARIANT_LANGUAGE = /\b(?:remain(?:s|ed)?\s+(?:unchanged|the same|in force)|stay(?:s|ed)?\s+(?:unchanged|the same)|(?:is|are|was|were)\s+(?:unchanged|the same)|unchanged|continu(?:e|es|ed)\s+in force|still applies?|no changes?|without changes?)\b/;
const NEGATED_MUTATION = /\b(?:not|never|cannot|no longer|by no means)\b.{0,60}\b(?:amend(?:ed)?|chang(?:e|ed)|delet(?:e|ed)|extend(?:ed)?|remov(?:e|ed)|replac(?:e|ed)|revis(?:e|ed)|substitut(?:e|ed)|supersed(?:e|ed)|updat(?:e|ed)|increas(?:e|ed)|decreas(?:e|ed)|rais(?:e|ed)|reduc(?:e|ed))\b|\b(?:do|does|did|will|would|shall|should|can|could|is|are|was|were)\s+not\s+(?:apply|take effect|become effective|control)\b|\b(?:is|are|was|were)\s+(?:excluded|void|withdrawn|rejected|declined)\b/;
const SPECULATIVE_MUTATION = /\b(?:may|might|can|could|would|should)\s+(?:be\s+)?(?:amend(?:ed)?|chang(?:e|ed)|delet(?:e|ed)|extend(?:ed)?|remov(?:e|ed)|replac(?:e|ed)|revis(?:e|ed)|substitut(?:e|ed)|supersed(?:e|ed)|updat(?:e|ed)|increas(?:e|ed)|decreas(?:e|ed)|rais(?:e|ed)|reduc(?:e|ed))\b|\b(?:proposal|request|option|draft|recommendation)\s+to\s+(?:amend|change|delete|extend|remove|replace|revise|substitute|supersede|update|increase|decrease|raise|reduce)\b|\b(?:if|unless|provided that|subject to|pending)\b.{0,80}\b(?:approval|approved|acceptance|accepted|authorize|authorized)\b|\b(?:amend(?:ed)?|chang(?:e|ed)|delet(?:e|ed)|extend(?:ed)?|remov(?:e|ed)|replac(?:e|ed)|revis(?:e|ed)|substitut(?:e|ed)|supersed(?:e|ed)|updat(?:e|ed)|increas(?:e|ed)|decreas(?:e|ed)|rais(?:e|ed)|reduc(?:e|ed))\b.{0,80}\b(?:proposal|request|draft|rejected|declined|pending approval|subject to approval)\b/;
const PASSIVE_SPECULATIVE_MUTATION = /\b(?:propos(?:e|ed|ing)|recommend(?:ed|ing)?|consider(?:ed|ing)?|plan(?:ned|ning)?|intend(?:ed|ing)?)\b.{0,50}\b(?:to\s+be\s+)?(?:amend(?:ed)?|chang(?:e|ed)|delet(?:e|ed)|extend(?:ed)?|remov(?:e|ed)|replac(?:e|ed)|revis(?:e|ed)|substitut(?:e|ed)|supersed(?:e|ed)|updat(?:e|ed)|increas(?:e|ed)|decreas(?:e|ed)|rais(?:e|ed)|reduc(?:e|ed))\b/;
const RESCINDED_MUTATION = /\b(?:this|that|the)\s+(?:change|amendment|revision|replacement|update|extension|deletion)\b.{0,80}\b(?:withdrawn|revoked|rescinded|rejected|declined|cancelled|canceled|void|not approved)\b|\b(?:deleted|removed|no longer applies)\b.{0,120}\b(?:reinstated|restored|revived|reapplied)\b/;
const NON_AFFIRMATIVE_CONTEXT = /\b(?:may|might|can|could|would|should)\b.{0,45}\b(?:amend|change|delete|extend|remove|replace|revise|substitute|supersede|update|increase|decrease|raise|reduce)|\b(?:is|are|was|were)\s+(?:expected|anticipated|proposed|recommended|planned|intended|considered)\s+to\b|\bit\s+(?:is|was)\s+(?:possible|expected|anticipated)\b|\b(?:draft|proposed)\s+amendment\b|\baccording to\s+(?:a|the)\s+(?:draft|proposal|recommendation)\b|\b(?:option|alternative)\s*:|\b(?:proposal|recommendation|request|option)\b.{0,40}\b(?:states?|says?|provides?|asserts?|indicates?|to|would|could)\b|\b(?:bidder|offeror|supplier|vendor)\b.{0,50}\b(?:expects?|requests?|proposes?|states?|says?|no longer applies)\b|\b(?:if|unless|when|once|provided(?: that)?|assuming|pending|contingent|conditional(?:ly)?\s+on|conditioned\s+on|on\s+condition\s+that|subject(?: only)?\s+to|only\s+(?:if|after)|in\s+the\s+event)\b|\b(?:following|after|on|upon|effective\s+(?:after|on|upon))\b.{0,60}\b(?:approval|approved|authorization|authorized|acceptance|accepted|funding|exercise|execution|option)\b|\b(?:for discussion|discussion only|for reference|for illustration|under review|under consideration)\b/;

function hasAffirmativeMutationPredicate(scope: string, effect: VersionedFact["effect"]) {
  const normalized = normalizePolarityText(scope);
  if (normalized.includes("?") || NON_AFFIRMATIVE_CONTEXT.test(normalized) ||
    PASSIVE_SPECULATIVE_MUTATION.test(normalized)) {
    return false;
  }
  if (effect === "delete") {
    return /\b(?:is|are|was|were|has been|have been|will be|shall be|must be)\s+(?:hereby\s+)?(?:deleted|removed|stricken|cancelled|canceled)\b/.test(normalized) ||
      /\b(?:this|the)?\s*(?:amendment|addendum|canada|buyer|contracting authority|department|agency)\s+(?:hereby\s+)?(?:deletes|removes|strikes|cancels)\b/.test(normalized) ||
      /(?:^|\b)(?:delete|remove|strike|cancel)\s*:/.test(normalized) ||
      /^(?:delete|remove|strike|cancel)\b/.test(normalized) ||
      /^(?:the\s+)?(?:insurance|commercial general liability|professional liability|basis of payment|appendix|criterion|contract|projection|forecast|solicitation|closing|submission|questions?|requirement)\b.{0,100}\bno longer applies\b/.test(normalized);
  }
  const passive = /\b(?:is|are|was|were|has been|have been|will be|shall be|must be)\s+(?:hereby\s+)?(?:amended|changed|replaced|substituted|revised|extended|updated|superseded|increased|decreased|raised|reduced)\b/.test(normalized);
  const authorityActive = /\b(?:this|the)?\s*(?:amendment|addendum|canada|buyer|contracting authority|department|agency)\s+(?:hereby\s+)?(?:amends|changes|replaces|substitutes|revises|extends|updates|supersedes|increases|decreases|raises|reduces)\b/.test(normalized);
  const definitiveState = /\b(?:amended|revised|updated|replacement)\s+(?:(?:technical|financial|price|evaluation|scoring|combined)\s+)?(?:ratio|weight|threshold|score|selection method|award basis|closing date|closing time|submission deadline|contract end date|projection horizon|basis of payment)\s+(?:is|are|equals?)\b/.test(normalized);
  const imperative = /(?:^|\b)(?:amend|change|replace|substitute|revise|extend|update)\s*:/.test(normalized) ||
    /^(?:amend|change|replace|substitute|revise|extend|update)\b/.test(normalized);
  const officialDeleteReplace = /\b(?:is|are)\s+deleted\b.{0,120}\band\s+replaced\b/.test(normalized) ||
    /\bdelete\s*:?.{0,120}\breplace\s+with\s*:/i.test(normalized);
  return passive || authorityActive || definitiveState || imperative || officialDeleteReplace;
}

function mutationActionScopes(fact: VersionedFact) {
  const action = fact.effect === "delete" ? DELETE_ACTION : REPLACE_ACTION;
  if (fact.citations.some((citation) =>
    RESCINDED_MUTATION.test(normalizePolarityText(citation.evidence_quote))
  )) return [];
  return mutationClauses(fact).flatMap((clause) => {
    const normalizedClause = normalizePolarityText(clause);
    if (NON_AFFIRMATIVE_CONTEXT.test(normalizedClause)) return [];
    const insuranceContext = /\binsurance\b/.test(normalizedClause);
    const separator = insuranceContext
      ? /\b(?:while|whereas|but)\b|,\s*(?=in its entirety\b|(?:insurance\s+)?(?:coverage\s+)?(?:contact|representative|attention|deductible|certificate|certification|coverage|limit|amount|liability|premium|fee|cost|payment|invoice|price|claim)\b)|\s+and\s+(?=(?:insurance\s+)?(?:coverage\s+)?(?:contact|representative|attention|deductible|certificate|certification|coverage|limit|amount|liability|premium|fee|cost|payment|invoice|price|claim)\b)/
      : /\b(?:while|whereas|but)\b|,\s*(?=in its entirety\b)/;
    const fragments = normalizedClause
      // Coordinated prose commonly puts a changed object next to an expressly
      // unchanged object. Treat those as separate semantic scopes so topic
      // words cannot be borrowed across the boundary.
      .split(separator)
      .map((scope) => {
        const trimmed = scope.trim();
        return insuranceContext && !/\binsurance\b/.test(trimmed) &&
          /^(?:coverage\s+)?(?:contact|representative|attention|deductible|certificate|certification|coverage|limit|amount|liability|premium|fee|cost|payment|invoice|price|claim)\b/.test(trimmed)
          ? `insurance ${trimmed}` : trimmed;
      })
      .filter(Boolean);
    return fragments.flatMap((scope, index) => {
      const previous = fragments[index - 1];
      let effectiveScope = previous && /^(?:if|unless|provided that|subject to|pending)\b/.test(previous)
        ? `${previous}, ${scope}` : scope;
      const officialDeleteReplace = fact.effect === "replace" && previous &&
        DELETE_ACTION.test(previous) && /\bin its entirety\b/.test(scope) && REPLACE_ACTION.test(scope);
      if (officialDeleteReplace) effectiveScope = `${previous} ${scope}`;
      if (!action.test(effectiveScope) || INVARIANT_LANGUAGE.test(effectiveScope) ||
        NEGATED_MUTATION.test(effectiveScope) || SPECULATIVE_MUTATION.test(effectiveScope) ||
        PASSIVE_SPECULATIVE_MUTATION.test(effectiveScope) ||
        !hasAffirmativeMutationPredicate(effectiveScope, fact.effect)) return [];
      // Official amendment forms sometimes express one replacement as
      // "Delete: <object>, in its entirety Replace With: ...". Rejoin only
      // that explicit delete/replace grammar; never rejoin arbitrary adjacent
      // comma fields.
      return [effectiveScope];
    });
  });
}

function deadlineTupleMatchesAuthoritativeSource(fact: VersionedFact, groundedKey: string) {
  const temporal = (value: string) => [...extractAssertionTokens(value)].filter((token) =>
    /^(?:date|time|timezone|utc-offset):/.test(token)
  );
  const asserted = new Set(temporal(fact.value));
  if (![...asserted].some((token) => token.startsWith("date:"))) return false;
  const compatible = fact.citations.flatMap((citation) =>
    deadlineRelationSegments(citation.evidence_quote).flatMap((segment) => {
      const key = deriveDeadlineFactKey(fact.value, [{ ...citation, evidence_quote: segment }]);
      if (!key || `derived:${key}` !== groundedKey) return [];
      const source = new Set(temporal(mutationTargetText(segment)));
      const assertedDates = [...asserted].filter((token) => token.startsWith("date:"));
      return assertedDates.every((token) => source.has(token)) ? [source] : [];
    })
  );
  if (compatible.length === 0) return false;
  const mostComplete = compatible.toSorted((left, right) => right.size - left.size)[0];
  const tokensFor = (values: Set<string>, prefix: string) =>
    new Set([...values].filter((token) => token.startsWith(prefix)));
  const same = (left: Set<string>, right: Set<string>) =>
    left.size === right.size && [...left].every((token) => right.has(token));
  if (!same(tokensFor(asserted, "date:"), tokensFor(mostComplete, "date:"))) return false;
  if (!same(tokensFor(asserted, "time:"), tokensFor(mostComplete, "time:"))) return false;
  const sourceOffsets = tokensFor(mostComplete, "utc-offset:");
  if (sourceOffsets.size > 0 && !same(tokensFor(asserted, "utc-offset:"), sourceOffsets)) return false;
  return true;
}

function structuredEvaluationMutationAuthorized(fact: VersionedFact) {
  if (fact.factKeySource !== "validated" || !fact.factKey?.startsWith("evaluation:")) {
    return false;
  }
  const field = fact.factKey.slice("evaluation:".length);
  const normalizedValue = normalizeEvidenceText(fact.value);
  return mutationActionScopes(fact).some((scope) => {
    if (field === "technical_weight" || field === "financial_weight") {
      const expected = Number(normalizedValue.replace(/%/g, "").trim());
      if (!Number.isFinite(expected)) return false;
      const targetLabel = field === "technical_weight" ? /\btechnical\b/ : /\b(?:financial|price)\b/;
      const otherLabel = field === "technical_weight" ? /\b(?:financial|price)\b/ : /\btechnical\b/;
      const values = scope
        .split(/[,;+]|\b(?:and|while|whereas|versus|vs\.?)\b/)
        .flatMap((part) => {
          if (!targetLabel.test(part) || otherLabel.test(part)) return [];
          const percentages = [...part.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:%|per\s*cent|percent(?:age)?)(?![a-z])/g)]
            .map((match) => Number(match[1]));
          return percentages.length === 1 ? percentages : [];
        });
      return new Set(values).size === 1 && values[0] === expected;
    }
    if (field === "selection_method") {
      return /\b(?:award|selection|selected|awarded)\b/.test(scope) &&
        normalizedValue.split(/\s+/).every((word) => scope.includes(word));
    }
    if (field === "rated_threshold") {
      const expected = [...extractAssertionTokens(fact.value)].filter((token) =>
        token.startsWith("number:")
      );
      return /\b(?:minimum|threshold|score|points?)\b/.test(scope) && expected.length > 0 &&
        expected.every((token) => extractAssertionTokens(scope).has(token));
    }
    if (field === "mandatory_gate") return /\bmandatory\b/.test(scope);
    return false;
  });
}

function mutationIsSourceAuthorized(fact: VersionedFact, allFacts: VersionedFact[]) {
  if (fact.effect === "add") return true;
  if (fact.documentRole !== "amendment" || !hasVerifiedCitations(fact)) return false;
  const groundedDeadlineKey = sourceDeadlineFactKey(fact);
  const topicLooksLikeDeadline = /\b(?:closing|deadline|due date|submission date)\b/.test(
    normalizeEvidenceText(fact.topic)
  );
  if (groundedDeadlineKey) {
    const actionScopes = mutationActionScopes(fact);
    if (actionScopes.length === 0) return false;
    if (fact.effect === "replace" && fact.factKeySource !== "fixture" &&
      !terminalMutationTargetSupportsFact(fact, true)) return false;
    if (!deadlineTupleMatchesAuthoritativeSource(fact, groundedDeadlineKey)) return false;
    const assertedDates = new Set([...extractAssertionTokens(fact.value)]
      .filter((token) => token.startsWith("date:")));
    return actionScopes.some((clause) => {
      const scoped = deriveDeadlineFactKey(fact.value, [{
        ...fact.citations[0], evidence_quote: clause
      }]);
      if (scoped && `derived:${scoped}` === groundedDeadlineKey &&
        (fact.effect === "delete" || mutationScopeSupportsNewValue(clause, fact.value, true))) return true;
      const clauseDates = [...extractAssertionTokens(clause)]
        .filter((token) => token.startsWith("date:"));
      // Some official amendments put the complete new closing tuple in one
      // clause and "extended from <old date> until <new date>" in another.
      // Link those clauses only through an old/new date pair, never through
      // adjacent generic words supplied by the model.
      return /\b(?:extend(?:ed|s)?|chang(?:e|ed|es)|revis(?:e|ed|es)|updat(?:e|ed|es))\s+from\b.*\b(?:to|until|through)\b/.test(clause) &&
        clauseDates.length >= 2 && clauseDates.some((token) => assertedDates.has(token)) &&
        mutationScopeSupportsNewValue(clause, fact.value, true);
    });
  }
  if (topicLooksLikeDeadline) return false;
  const structuredEvaluationFact = fact.factKeySource === "validated" &&
    fact.factKey?.startsWith("evaluation:");
  if (fact.effect === "replace" && fact.factKeySource !== "fixture" &&
    !(structuredEvaluationFact && structuredEvaluationMutationAuthorized(fact)) &&
    !terminalMutationTargetSupportsFact(fact)) return false;
  const effectiveSourceKey = (candidate: VersionedFact) => {
    const owned = candidate.factKey ? normalizeEvidenceText(candidate.factKey) : null;
    return owned ?? deriveSourceFactKey(candidate);
  };
  const groundedSourceKey = effectiveSourceKey(fact);
  if (groundedSourceKey) {
    const priorExists = allFacts.some((candidate) => candidate !== fact &&
      effectiveSourceKey(candidate) === groundedSourceKey && compareFacts(candidate, fact) < 0);
    if (!priorExists) return false;
    const keyAuthorizes = (candidateKey: string | null) => Boolean(candidateKey &&
      (candidateKey === groundedSourceKey || groundedSourceKey.startsWith(`${candidateKey}:`)));
    const actionBindsKey = (candidate: VersionedFact) => mutationActionScopes(candidate)
      .some((scope) => {
        const candidateKey = effectiveSourceKey(candidate);
        if (candidate.factKeySource === "fixture" && keyAuthorizes(candidateKey)) return true;
        if (candidate.factKeySource === "validated" && keyAuthorizes(candidateKey) &&
          (candidate.effect === "delete" || structuredEvaluationMutationAuthorized(candidate) ||
            mutationScopeSupportsNewValue(scope, candidate.value))) return true;
        return (candidate.effect === "delete" || mutationScopeSupportsNewValue(scope, candidate.value)) &&
          keyAuthorizes(deriveSourceFactKey({
          topic: candidate.topic,
          value: candidate.value,
          documentSha256: candidate.documentSha256,
          citations: candidate.citations.map((citation) => ({ ...citation, evidence_quote: scope }))
          }));
      });
    if (actionBindsKey(fact)) return true;
    return fact.factKeySource === "fixture" && allFacts.some((directive) => directive !== fact &&
      directive.factKeySource === "fixture" &&
      directive.documentSha256 === fact.documentSha256 && sameStage(directive, fact) &&
      hasVerifiedCitations(directive) && directive.effect !== "add" &&
      keyAuthorizes(effectiveSourceKey(directive)) && actionBindsKey(directive));
  }
  // Topic similarity is useful for grouping additive observations, but it is
  // never a capability to destroy an earlier fact. Unknown mutation objects
  // remain visible only as needs-review history.
  return false;
}

function topicsLikelyAlias(left: VersionedFact, right: VersionedFact) {
  const leftIdentity = closedFactIdentity(left);
  const rightIdentity = closedFactIdentity(right);
  if (leftIdentity || rightIdentity) return Boolean(
    leftIdentity && rightIdentity && leftIdentity === rightIdentity
  );
  if (left.effect !== "add" || right.effect !== "add") return false;
  const leftTokens = topicTokens(left.topic);
  const rightTokens = topicTokens(right.topic);
  const leftNumbers = leftTokens.filter((token) => /^\d+$/.test(token));
  const rightNumbers = rightTokens.filter((token) => /^\d+$/.test(token));
  if (leftNumbers.length > 0 && rightNumbers.length > 0 &&
    leftNumbers.toSorted().join(":") !== rightNumbers.toSorted().join(":")) return false;
  const structuralKinds = ["annex", "appendix", "row", "section", "table"];
  const leftKinds = structuralKinds.filter((token) => leftTokens.includes(token));
  const rightKinds = structuralKinds.filter((token) => rightTokens.includes(token));
  if (leftKinds.length > 0 && rightKinds.length > 0 &&
    leftKinds.toSorted().join(":") !== rightKinds.toSorted().join(":")) return false;
  const domainKinds = ["closing", "delivery", "financial", "insurance", "security", "technical"];
  const canonicalDomain = (tokens: string[]) => domainKinds.filter((token) =>
    tokens.includes(token) || (token === "financial" && tokens.includes("price"))
  );
  const leftDomains = canonicalDomain(leftTokens);
  const rightDomains = canonicalDomain(rightTokens);
  if (leftDomains.length > 0 && rightDomains.length > 0 &&
    leftDomains.toSorted().join(":") !== rightDomains.toSorted().join(":")) return false;

  // Fuzzy aliasing is limited to scalar assertions. It is intended to catch
  // wording drift such as "projection end year" / "projection horizon", not
  // merge unrelated prose clauses.
  if (extractAssertionTokens(left.value).size === 0 || extractAssertionTokens(right.value).size === 0) {
    return false;
  }
  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const smaller = Math.min(leftTokens.length, rightTokens.length);
  return intersection >= 2 && (intersection / union >= 0.45 || intersection / smaller >= 0.75);
}

function amendmentRank(fact: VersionedFact): { number: number; label: string } {
  if (fact.documentRole === "base") return { number: -1, label: "" };
  const match = fact.amendmentNumber?.match(/\d+/);
  return {
    number: match ? Number.parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER,
    label: fact.amendmentNumber?.normalize("NFKC").toLowerCase() ?? ""
  };
}

function compareFacts(left: VersionedFact, right: VersionedFact) {
  const leftRank = amendmentRank(left);
  const rightRank = amendmentRank(right);
  return (
    leftRank.number - rightRank.number ||
    leftRank.label.localeCompare(rightRank.label) ||
    left.documentSha256.localeCompare(right.documentSha256) ||
    left.id.localeCompare(right.id)
  );
}

function sameStage(left: VersionedFact, right: VersionedFact) {
  const a = amendmentRank(left);
  const b = amendmentRank(right);
  return a.number === b.number && a.label === b.label;
}

function groupedFacts(input: VersionedFact[]) {
  const parents = input.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const join = (left: number, right: number) => {
    const a = root(left);
    const b = root(right);
    if (a !== b) parents[Math.max(a, b)] = Math.min(a, b);
  };

  const firstByKey = new Map<string, number>();
  for (const [index, fact] of input.entries()) {
    const key = canonicalTopicKey(fact);
    const first = firstByKey.get(key);
    if (first === undefined) firstByKey.set(key, index);
    else join(first, index);
    // Model-provided IDs are labels, not mutation capabilities. In
    // particular, supersedesIds never joins otherwise unrelated topics.
  }
  for (let left = 0; left < input.length; left += 1) {
    for (let right = left + 1; right < input.length; right += 1) {
      if (root(left) !== root(right) && topicsLikelyAlias(input[left], input[right])) join(left, right);
    }
  }
  const groups = new Map<number, VersionedFact[]>();
  for (const [index, fact] of input.entries()) {
    const key = root(index);
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }
  return groups;
}

function scalarValuesConflict(candidates: VersionedFact[]) {
  if (candidates.length < 2) return false;
  const signatures = candidates.map((fact) => [...extractAssertionTokens(fact.value)].toSorted().join("|"));
  return signatures.every(Boolean) && new Set(signatures).size > 1;
}

export function reconcileVersionedFacts(input: VersionedFact[]): {
  facts: ReconciledFact[];
  conflicts: Conflict[];
  unauthorizedMutationIds: string[];
} {
  const result = new Map<string, ReconciledFact>();
  const conflicts: Conflict[] = [];
  const unauthorizedMutationIds = new Set(input
    .filter((fact) => fact.effect !== "add" && !mutationIsSourceAuthorized(fact, input))
    .map((fact) => fact.id));

  for (const unsortedFacts of groupedFacts(input).values()) {
    const facts = [...unsortedFacts].sort(compareFacts);
    let active: ReconciledFact[] = [];
    let currentConflict: Conflict | null = null;
    for (let cursor = 0; cursor < facts.length; ) {
      const stage: VersionedFact[] = [facts[cursor]];
      cursor += 1;
      while (cursor < facts.length && sameStage(stage[0], facts[cursor])) {
        stage.push(facts[cursor]);
        cursor += 1;
      }

      const authoritative = stage.filter(hasVerifiedCitations);
      const replacesCurrent = authoritative.some(
        (fact) => !unauthorizedMutationIds.has(fact.id) &&
          (fact.effect === "replace" || fact.effect === "delete")
      );
      active = active.filter((fact) => {
        const superseded = replacesCurrent;
        if (superseded) result.set(fact.id, { ...fact, status: "superseded" });
        return !superseded;
      });
      if (replacesCurrent) currentConflict = null;

      const candidates = authoritative
        .filter((fact) => fact.effect !== "delete" && !unauthorizedMutationIds.has(fact.id));
      const distinctValues = new Map<string, string>();
      for (const fact of candidates) {
        const key = normalizeEvidenceText(fact.value);
        if (!distinctValues.has(key)) distinctValues.set(key, fact.value);
      }
      const conflictAtStage = distinctValues.size > 1 && (
        candidates.some((fact) => fact.effect === "replace") || scalarValuesConflict(candidates)
      );
      if (conflictAtStage) {
        const conflicted = candidates.map((fact): ReconciledFact => ({ ...fact, status: "conflicted" }));
        for (const fact of conflicted) result.set(fact.id, fact);
        active = [...active, ...conflicted];
        currentConflict = {
          id: `conflict-${canonicalTopicKey(stage[0]).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "topic"}`,
          topic: stage[0].topic,
          status: "conflicted",
          candidate_values: [...distinctValues.values()],
          safe_answer: "The supplied amendment is internally inconsistent; clarification is required.",
          citations: deduplicateCitations(candidates.flatMap((fact) => fact.citations))
        };
      } else {
        for (const fact of candidates) {
          const reconciled: ReconciledFact = { ...fact, status: "active" };
          result.set(fact.id, reconciled);
          active.push(reconciled);
        }
      }

      for (const fact of stage.filter((item) =>
        !hasVerifiedCitations(item) || item.effect === "delete" || unauthorizedMutationIds.has(item.id)
      )) {
        // Unsupported mutations and deletion tombstones are retained only as
        // history. Neither can become a current assertion.
        result.set(fact.id, { ...fact, status: "superseded" });
      }
    }
    if (!currentConflict && scalarValuesConflict(active)) {
      const distinctValues = new Map<string, string>();
      for (const fact of active) {
        const key = normalizeEvidenceText(fact.value);
        if (!distinctValues.has(key)) distinctValues.set(key, fact.value);
        const conflicted: ReconciledFact = { ...fact, status: "conflicted" };
        result.set(fact.id, conflicted);
      }
      currentConflict = {
        id: `conflict-${canonicalTopicKey(active[0]).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "topic"}`,
        topic: active[0].topic,
        status: "conflicted",
        candidate_values: [...distinctValues.values()],
        safe_answer: "The supplied amendment is internally inconsistent; clarification is required.",
        citations: deduplicateCitations(active.flatMap((fact) => fact.citations))
      };
      active = active.map((fact) => ({ ...fact, status: "conflicted" }));
    }
    if (currentConflict && active.some((fact) => fact.status === "conflicted")) {
      conflicts.push(currentConflict);
    }
  }

  for (const fact of input) {
    if (!result.has(fact.id)) result.set(fact.id, { ...fact, status: "superseded" });
  }
  return {
    facts: [...result.values()].sort((left, right) => left.id.localeCompare(right.id)),
    conflicts: conflicts.sort((left, right) => left.id.localeCompare(right.id)),
    unauthorizedMutationIds: [...unauthorizedMutationIds].sort()
  };
}

function deduplicateCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.document_sha256}:${citation.pdf_page_1based}:${citation.evidence_quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
