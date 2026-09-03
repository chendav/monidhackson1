import { describe, expect, it } from "vitest";
import { AnalysisResultSchema } from "@/contracts";
import {
  createEdmontonSampleResult,
  EDMONTON_FORM_PHYSICAL_PAGES,
  EDMONTON_PAGES,
  EDMONTON_SHA256,
  edmontonGolden
} from "@/lib/fixtures/edmonton";

describe("Edmonton 100022184-A golden fixture", () => {
  const result = createEdmontonSampleResult();

  it("pins the verified source hash, 55 physical pages, and eight trailing form pages", () => {
    expect(AnalysisResultSchema.parse(result)).toBeTruthy();
    expect(result.document_manifest[0]).toMatchObject({ sha256: EDMONTON_SHA256, pages: EDMONTON_PAGES });
    expect(edmontonGolden.printedBodyEndsAt).toBe(47);
    expect(EDMONTON_FORM_PHYSICAL_PAGES).toEqual([48, 49, 50, 51, 52, 53, 54, 55]);
    const pageCountClaim = result.claims.find((claim) => claim.claim_id === "printed-vs-physical-pages");
    expect(pageCountClaim?.citations.map((citation) => citation.pdf_page_1based)).toEqual([47, 55]);
  });

  it("preserves M3's upper bound rather than requiring exactly three resources", () => {
    const m3 = result.requirements.find((requirement) => requirement.id === "m3-resources");
    expect(edmontonGolden.m3MaximumResources).toBe(3);
    expect(m3?.text).toMatch(/up to three/i);
    expect(m3?.text).not.toMatch(/exactly three/i);
    expect(m3?.citations[0].pdf_page_1based).toBe(43);
  });

  it("keeps blank pricing unknown and detects the Annex D/E security inconsistency", () => {
    expect(edmontonGolden.pricingValue).toBeNull();
    expect(result.blocking_unknowns).toContain("Bidder-specific prices remain blank.");
    const conflict = result.conflicts.find((item) => item.id === "conflict-security-annex-letter");
    expect(conflict?.candidate_values).toEqual(["Annex D", "Annex E"]);
    expect(conflict?.citations.map((citation) => citation.pdf_page_1based)).toEqual([17, 43]);
  });

  it("covers mandatory, evaluation, security, pricing, and cleanup audit facts", () => {
    expect(result.requirements.filter((item) => item.id.startsWith("m"))).toHaveLength(4);
    expect(result.evaluation.selection_method).toBe("Lowest evaluated price");
    expect(result.requirements.filter((item) => item.category === "security")).toHaveLength(2);
    expect(result.requirements.some((item) => item.category === "financial")).toBe(true);
    expect(result.document_manifest.every((document) => document.cleanup_status === "deleted")).toBe(true);
    expect(result.quality).toMatchObject({ critical_claims: 12, critical_claims_cited: 12, search_events: 0 });
  });
});
