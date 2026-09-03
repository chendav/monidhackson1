import type { Citation, Conflict } from "@/contracts";
import { extractAssertionTokens } from "@/lib/evidence/citations";
import { normalizeEvidenceText } from "@/lib/pdf/page-index";

export interface VersionedFact {
  id: string;
  topic: string;
  /** A server-owned key may be supplied for closed taxonomies such as evaluation fields. */
  factKey?: string;
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

function canonicalTopicKey(fact: VersionedFact) {
  if (fact.factKey) return `owned:${normalizeEvidenceText(fact.factKey)}`;
  const deadlineKey = sourceDeadlineFactKey(fact);
  if (deadlineKey) return deadlineKey;
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
    const questionSubject = "(?:questions?|enquir(?:y|ies)|clarifications?|requests? for clarification|q\\s*&\\s*a|question(?:s)?[- ]and[- ]answer(?:s)?)";
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
      /\b(?:deadline|closing (?:date|time)|due date)\s+(?:for|to)\s+(?:submitting\s+)?(?:bids?|proposals?|tenders?|offers?|submissions?)\b/.test(sourceText);
    return explicitClosing || submissionTiming ? "deadline:solicitation" : null;
  };
  // The value and topic are model-controlled. Scope must come from one
  // verified source clause that also contains every objective value token;
  // otherwise an adjacent "solicitation" or "questions" sentence could be
  // borrowed to authorize the wrong deadline chain.
  const assertedTokens = extractAssertionTokens(value);
  if (assertedTokens.size === 0) return null;
  const supportedScopes = new Set(citations.flatMap((citation) =>
    normalizeEvidenceText(citation.evidence_quote)
      .split(/(?<!a\.m)(?<!p\.m)\.\s+|[;\n]+/)
      .flatMap((clause) => {
        const scope = classify(clause);
        if (!scope) return [];
        const evidenceTokens = extractAssertionTokens(clause);
        return [...assertedTokens].every((token) => evidenceTokens.has(token)) ? [scope] : [];
      })
  ));
  return supportedScopes.size === 1 ? [...supportedScopes][0] : null;
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

const REPLACE_ACTION = /\b(?:amend(?:ed|s)?|replace(?:s|d)?|substitut(?:e|ed|es)|revis(?:e|ed|es)|chang(?:e|ed|es)|extend(?:s|ed)?|updat(?:e|ed|es)|supersed(?:e|ed|es))\b/;
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

const INVARIANT_LANGUAGE = /\b(?:remain(?:s|ed)?\s+unchanged|unchanged|remain(?:s|ed)?\s+in force|continu(?:e|es|ed)\s+in force|still applies?)\b/;

function mutationActionScopes(fact: VersionedFact) {
  const action = fact.effect === "delete" ? DELETE_ACTION : REPLACE_ACTION;
  return mutationClauses(fact).flatMap((clause) => {
    const fragments = clause
      // Coordinated prose commonly puts a changed object next to an expressly
      // unchanged object. Treat those as separate semantic scopes so topic
      // words cannot be borrowed across the boundary.
      .split(/\s*,\s*|\b(?:while|whereas|but)\b/)
      .map((scope) => scope.trim())
      .filter(Boolean);
    return fragments.flatMap((scope, index) => {
      if (!action.test(scope) || INVARIANT_LANGUAGE.test(scope)) return [];
      const previous = fragments[index - 1];
      // Official amendment forms sometimes express one replacement as
      // "Delete: <object>, in its entirety Replace With: ...". Rejoin only
      // that explicit delete/replace grammar; never rejoin arbitrary adjacent
      // comma fields.
      if (fact.effect === "replace" && previous && DELETE_ACTION.test(previous) &&
        /\bin its entirety\b/.test(scope) && REPLACE_ACTION.test(scope)) {
        return [`${previous} ${scope}`];
      }
      return [scope];
    });
  });
}

function hasMutationLanguage(fact: VersionedFact) {
  return mutationClauses(fact).length > 0;
}

function mutationScopeTokens(fact: VersionedFact) {
  return topicTokens(fact.topic).filter((token) =>
    !["row", "table", "controlling"].includes(token) && !/^\d+$/.test(token)
  );
}

function mutationClauseSupportsTopic(target: VersionedFact, directive: VersionedFact) {
  const targetTokens = mutationScopeTokens(target).filter((token) =>
    !["amend", "amended", "change", "changed", "delete", "deleted", "replace", "replaced",
      "revise", "revised", "update", "updated"].includes(token)
  );
  if (targetTokens.length === 0) return false;
  const structuralTopic = targetTokens.some((token) => /^(?:[a-z]+\d+|\d+(?:\.\d+)+)$/.test(token));
  // A model-owned one-word topic such as "insurance" is a category, not a
  // source-grounded object identity. It cannot authorize destructive
  // reconciliation unless it carries a structural identifier such as M3.
  if (targetTokens.length < 2 && !structuralTopic) return false;
  return mutationActionScopes(directive).some((scope) => {
    const sourceTokens = new Set(topicTokens(scope));
    const shared = targetTokens.filter((token) => sourceTokens.has(token));
    const explicitStructuralToken = shared.some((token) =>
      /^(?:[a-z]+\d+|\d+(?:\.\d+)+)$/.test(token)
    );
    // Model topics must bind at least two object words unless a structural
    // identifier such as M3 is present in the mutation clause.
    return explicitStructuralToken || shared.length >= Math.min(2, targetTokens.length);
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
    const assertedDates = new Set([...extractAssertionTokens(fact.value)]
      .filter((token) => token.startsWith("date:")));
    return mutationClauses(fact).some((clause) => {
      const scoped = deriveDeadlineFactKey(fact.value, [{
        ...fact.citations[0], evidence_quote: clause
      }]);
      if (scoped && `derived:${scoped}` === groundedDeadlineKey) return true;
      const clauseDates = [...extractAssertionTokens(clause)]
        .filter((token) => token.startsWith("date:"));
      // Some official amendments put the complete new closing tuple in one
      // clause and "extended from <old date> until <new date>" in another.
      // Link those clauses only through an old/new date pair, never through
      // adjacent generic words supplied by the model.
      return clauseDates.length >= 2 && clauseDates.some((token) => assertedDates.has(token));
    });
  }
  if (topicLooksLikeDeadline) return false;
  if (hasMutationLanguage(fact) && mutationClauseSupportsTopic(fact, fact)) return true;
  return allFacts.some((directive) =>
    directive !== fact && directive.documentSha256 === fact.documentSha256 &&
    sameStage(directive, fact) && hasVerifiedCitations(directive) &&
    directive.effect !== "add" && hasMutationLanguage(directive) &&
    mutationClauseSupportsTopic(fact, directive)
  );
}

function topicsLikelyAlias(left: VersionedFact, right: VersionedFact) {
  if (left.factKey || right.factKey) return Boolean(
    left.factKey && right.factKey && canonicalTopicKey(left) === canonicalTopicKey(right)
  );
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
