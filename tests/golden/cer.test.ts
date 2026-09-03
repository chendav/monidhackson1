import { describe, expect, it } from "vitest";
import { reconcileVersionedFacts, type VersionedFact } from "@/lib/analysis/reconciliation";
import { CER_DOCUMENTS, cerGoldenFacts, cerManifest } from "@/lib/fixtures/cer";

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((tail) => [item, ...tail])
  );
}

function signature(facts: VersionedFact[]) {
  const reconciled = reconcileVersionedFacts(facts);
  return JSON.stringify({
    facts: reconciled.facts.map((fact) => [fact.id, fact.status]),
    conflicts: reconciled.conflicts.map((conflict) => [
      conflict.topic,
      [...conflict.candidate_values].sort(),
      conflict.citations.map((citation) => `${citation.document_sha256}:${citation.pdf_page_1based}`).sort()
    ])
  });
}

describe("CER base plus amendments golden reconciliation", () => {
  it("pins all four source hashes/pages within the package limit", () => {
    expect(CER_DOCUMENTS.map(({ pages }) => pages)).toEqual([58, 6, 2, 9]);
    expect(cerManifest.reduce((sum, document) => sum + document.pages, 0)).toBe(75);
    expect(CER_DOCUMENTS.every((document) => /^[a-f0-9]{64}$/.test(document.sha256))).toBe(true);
  });

  it("is independent of upload order for every permutation", () => {
    const expected = signature(cerGoldenFacts);
    for (const order of permutations(cerGoldenFacts)) {
      expect(signature(order)).toBe(expected);
    }
  });

  it("preserves superseded dates while rendering the amended date current", () => {
    const result = reconcileVersionedFacts(cerGoldenFacts);
    expect(result.facts.find((fact) => fact.id === "closing-date-base")?.status).toBe("superseded");
    expect(result.facts.find((fact) => fact.id === "closing-date-amendment-002")?.status).toBe("active");
  });

  it("surfaces amendment 003's 2050/2055 contradiction with three citations", () => {
    const result = reconcileVersionedFacts(cerGoldenFacts);
    const conflict = result.conflicts.find((item) => item.topic.includes("projection horizon"));
    expect(conflict?.candidate_values.sort()).toEqual(["2050", "2055"]);
    expect(conflict?.citations).toHaveLength(3);
    expect(conflict?.citations.map((citation) => citation.pdf_page_1based).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([2, 5, 40]);
    expect(result.facts.find((fact) => fact.id === "forecast-horizon-base")?.status).toBe("superseded");
    expect(result.facts.filter((fact) => fact.id.startsWith("forecast-horizon-003")).every((fact) => fact.status === "conflicted")).toBe(true);
  });
});
