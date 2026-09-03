import { describe, expect, it } from "vitest";
import { reconcileVersionedFacts, type VersionedFact } from "@/lib/analysis/reconciliation";
import {
  CER_DOCUMENTS,
  CER_GOLDEN_PROVENANCE,
  CER_M3_ROW_DEFINITIONS,
  CER_REQUIRED_CONFLICT_SAFE_ANSWER,
  cerEvaluationGolden,
  cerGoldenFacts,
  cerM3VersionedFacts,
  cerManifest
} from "@/lib/fixtures/cer";

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
      conflict.safe_answer,
      conflict.citations.map((citation) => `${citation.document_sha256}:${citation.pdf_page_1based}`).sort()
    ])
  });
}

describe("CER base plus amendments manually frozen public sample", () => {
  it("pins provenance and the exact four official source hashes/pages", () => {
    expect(CER_GOLDEN_PROVENANCE).toMatchObject({
      kind: "manually_frozen_public_sample",
      live_provider_proof: false
    });
    expect(CER_DOCUMENTS.map(({ name, sha256, pages, amendment }) => ({ name, sha256, pages, amendment }))).toEqual([
      {
        name: "cer-main.pdf",
        sha256: "894b876fdfdacb2aec0571f4cf2f29be08ebc2380c6e3251bb48885f69d31bfb",
        pages: 58,
        amendment: null
      },
      {
        name: "cer-amendment-001.pdf",
        sha256: "ec135a6ddf7a22120530bef89612cfedc7f007c64cf313f2b8de46d143027cfc",
        pages: 6,
        amendment: "001"
      },
      {
        name: "cer-amendment-002.pdf",
        sha256: "300a06081b195ea28f858feb20bd6780f596ceefc638495c4fdd63a5edea352c",
        pages: 2,
        amendment: "002"
      },
      {
        name: "cer-amendment-003.pdf",
        sha256: "98f6299df44edaab9e8ec834b476d88358d5af75923646b5fb190e709be1204f",
        pages: 9,
        amendment: "003"
      }
    ]);
    expect(cerManifest.reduce((sum, document) => sum + document.pages, 0)).toBe(75);
    expect(cerManifest.map((document) => document.amendment_number)).toEqual([null, "001", "002", "003"]);
  });

  it("is independent of all 24 possible document upload orders", () => {
    const factsByDocument = CER_DOCUMENTS.map((document) =>
      cerGoldenFacts.filter((fact) => fact.documentSha256 === document.sha256)
    );
    expect(factsByDocument.every((facts) => facts.length > 0)).toBe(true);
    const expected = signature(cerGoldenFacts);
    for (const documentOrder of permutations(factsByDocument)) {
      expect(signature(documentOrder.flat())).toBe(expected);
    }
  });

  it("supersedes the old close and makes 2026-09-15 14:00 MDT current", () => {
    const result = reconcileVersionedFacts(cerGoldenFacts);
    expect(result.facts.find((fact) => fact.id === "closing-date-base")).toMatchObject({
      status: "superseded",
      value: "2026-09-03T14:00:00-06:00"
    });
    const current = result.facts.find((fact) => fact.id === "closing-date-amendment-002");
    expect(current).toMatchObject({
      status: "active",
      value: "2026-09-15T14:00:00-06:00",
      amendmentNumber: "002"
    });
    expect(current?.citations.map((citation) => citation.pdf_page_1based)).toEqual([1, 2]);
  });

  it("makes Amendment 001's entire attached Basis of Payment controlling", () => {
    const result = reconcileVersionedFacts(cerGoldenFacts);
    expect(result.facts.find((fact) => fact.id === "basis-of-payment-base")?.status).toBe("superseded");
    const replacement = result.facts.find((fact) => fact.id === "basis-of-payment-amendment-001");
    expect(replacement).toMatchObject({
      status: "active",
      value: "Amendment 001 Annex Basis of Payment (entire replacement)",
      amendmentNumber: "001",
      effect: "replace"
    });
    expect(replacement?.citations.map((citation) => citation.pdf_page_1based)).toEqual([2, 4]);
    expect(replacement?.citations[0].evidence_quote).toMatch(/in its entirety/i);
  });

  it("supersedes every one of the 37 original M3 rows with Amendment 003", () => {
    expect(CER_M3_ROW_DEFINITIONS.map((definition) => definition.row)).toEqual(
      Array.from({ length: 37 }, (_, index) => index + 1)
    );
    expect(cerM3VersionedFacts).toHaveLength(74);
    const result = reconcileVersionedFacts(cerGoldenFacts);
    const originalRows = result.facts.filter((fact) => /^m3-row-\d+-base$/.test(fact.id));
    const replacementRows = result.facts.filter((fact) => /^m3-row-\d+-amendment-003$/.test(fact.id));
    expect(originalRows).toHaveLength(37);
    expect(originalRows.every((fact) => fact.status === "superseded")).toBe(true);
    expect(replacementRows).toHaveLength(37);
    expect(replacementRows.every((fact) => fact.status === "active" && fact.effect === "replace")).toBe(true);
    expect(result.facts.find((fact) => fact.id === "m3-table-base")?.status).toBe("superseded");
    const controllingTable = result.facts.find((fact) => fact.id === "m3-table-amendment-003");
    expect(controllingTable).toMatchObject({ status: "active", amendmentNumber: "003", effect: "replace" });
    expect(controllingTable?.citations[0]).toMatchObject({ pdf_page_1based: 5 });
    expect(controllingTable?.citations[0].evidence_quote).toMatch(/deleted in its entirety and replaced/i);
  });

  it("freezes the mandatory gate, 50/94 threshold, 70/30 weighting, and highest-combined-rating method", () => {
    expect(cerEvaluationGolden.mandatoryGate.value).toBe(true);
    expect(cerEvaluationGolden.mandatoryGate.citations.map((citation) => citation.pdf_page_1based)).toEqual([9]);
    expect(cerEvaluationGolden.ratedThreshold).toMatchObject({ minimum: 50, maximum: 94, display: "50/94" });
    expect(cerEvaluationGolden.ratedThreshold.citations.map((citation) => citation.pdf_page_1based)).toEqual([11, 52]);
    expect(cerEvaluationGolden.technicalWeight.value).toBe(70);
    expect(cerEvaluationGolden.financialWeight.value).toBe(30);
    expect(cerEvaluationGolden.selectionMethod.value).toBe("Highest combined rating of technical merit and price");
    expect(cerEvaluationGolden.selectionMethod.citations.map((citation) => citation.pdf_page_1based)).toEqual([11]);
  });

  it("surfaces Amendment 003's 2050/2055 contradiction using exactly current p2, p5, and p6 evidence", () => {
    const result = reconcileVersionedFacts(cerGoldenFacts);
    const conflict = result.conflicts.find((item) => item.topic.includes("projection end year"));
    expect(conflict?.candidate_values.toSorted()).toEqual(["2050", "2055"]);
    expect(conflict?.safe_answer).toBe(CER_REQUIRED_CONFLICT_SAFE_ANSWER);
    expect(conflict?.citations.map((citation) => ({
      sha256: citation.document_sha256,
      page: citation.pdf_page_1based
    })).toSorted((left, right) => (left.page ?? 0) - (right.page ?? 0))).toEqual([
      { sha256: CER_DOCUMENTS[3].sha256, page: 2 },
      { sha256: CER_DOCUMENTS[3].sha256, page: 5 },
      { sha256: CER_DOCUMENTS[3].sha256, page: 6 }
    ]);
    expect(result.facts.find((fact) => fact.id === "forecast-horizon-base")?.status).toBe("superseded");
    expect(
      result.facts
        .filter((fact) => /^forecast-horizon-003-(answer|sow|table)$/.test(fact.id))
        .every((fact) => fact.status === "conflicted")
    ).toBe(true);
  });
});
