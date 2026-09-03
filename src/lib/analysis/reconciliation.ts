import type { Citation, Conflict } from "@/contracts";
import { normalizeEvidenceText } from "@/lib/pdf/page-index";

export interface VersionedFact {
  id: string;
  topic: string;
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

export function reconcileVersionedFacts(input: VersionedFact[]): {
  facts: ReconciledFact[];
  conflicts: Conflict[];
} {
  const result = new Map<string, ReconciledFact>();
  const conflicts: Conflict[] = [];
  const topics = Map.groupBy(input, (fact) => normalizeEvidenceText(fact.topic));

  for (const [topicKey, unsortedFacts] of topics) {
    const facts = [...unsortedFacts].sort(compareFacts);
    let active: ReconciledFact[] = [];
    for (let cursor = 0; cursor < facts.length; ) {
      const stage: VersionedFact[] = [facts[cursor]];
      cursor += 1;
      while (cursor < facts.length && sameStage(stage[0], facts[cursor])) {
        stage.push(facts[cursor]);
        cursor += 1;
      }

      const explicitIds = new Set(stage.flatMap((fact) => fact.supersedesIds ?? []));
      const replacesCurrent = stage.some((fact) => fact.effect === "replace" || fact.effect === "delete");
      active = active.filter((fact) => {
        const superseded = replacesCurrent || explicitIds.has(fact.id);
        if (superseded) result.set(fact.id, { ...fact, status: "superseded" });
        return !superseded;
      });

      const candidates = stage.filter((fact) => fact.effect !== "delete");
      const distinctValues = new Map<string, string>();
      for (const fact of candidates) {
        const key = normalizeEvidenceText(fact.value);
        if (!distinctValues.has(key)) distinctValues.set(key, fact.value);
      }
      if (distinctValues.size > 1 && candidates.some((fact) => fact.effect === "replace")) {
        const historicalCitations = facts
          .slice(0, cursor)
          .flatMap((fact) => fact.citations);
        const conflicted = candidates.map((fact): ReconciledFact => ({ ...fact, status: "conflicted" }));
        for (const fact of conflicted) result.set(fact.id, fact);
        active = [...active, ...conflicted];
        conflicts.push({
          id: `conflict-${topicKey.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "topic"}`,
          topic: stage[0].topic,
          status: "conflicted",
          candidate_values: [...distinctValues.values()],
          safe_answer: "The source package contains conflicting current values; seek written clarification before relying on either value.",
          citations: deduplicateCitations(historicalCitations)
        });
      } else {
        for (const fact of candidates) {
          const reconciled: ReconciledFact = { ...fact, status: "active" };
          result.set(fact.id, reconciled);
          active.push(reconciled);
        }
      }
      for (const fact of stage.filter((item) => item.effect === "delete")) {
        result.set(fact.id, { ...fact, status: "active" });
      }
    }
  }

  for (const fact of input) {
    if (!result.has(fact.id)) result.set(fact.id, { ...fact, status: "superseded" });
  }
  return {
    facts: [...result.values()].sort((left, right) => left.id.localeCompare(right.id)),
    conflicts
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
