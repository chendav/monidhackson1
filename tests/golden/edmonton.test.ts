import { describe, expect, it } from "vitest";
import { AnalysisResultSchema } from "@/contracts";
import {
  createEdmontonSampleResult,
  EDMONTON_ACROFORM_UNIQUE_FIELDS,
  EDMONTON_FORM_PHYSICAL_PAGES,
  EDMONTON_FORM_WIDGETS_BY_PAGE,
  EDMONTON_GOLDEN_PROVENANCE,
  EDMONTON_PAGES,
  EDMONTON_PRICING_BLANK_AMOUNTS,
  EDMONTON_SHA256,
  EDMONTON_WIDGETS,
  edmontonGolden
} from "@/lib/fixtures/edmonton";

describe("Edmonton 100022184-A manually frozen public sample", () => {
  const result = createEdmontonSampleResult();

  it("pins provenance, SHA, 55 physical pages, the printed 47-page body, and all form structure totals", () => {
    expect(AnalysisResultSchema.parse(result)).toBeTruthy();
    expect(EDMONTON_GOLDEN_PROVENANCE).toMatchObject({
      kind: "manually_frozen_public_sample",
      live_provider_proof: false,
      verified_against_official_pdf_sha256: EDMONTON_SHA256
    });
    expect(result.quality.warnings).toContain(
      "This is a manually frozen public sample, not proof of a live provider run."
    );
    expect(result.document_manifest[0]).toMatchObject({ sha256: EDMONTON_SHA256, pages: EDMONTON_PAGES });
    expect(edmontonGolden.printedBodyEndsAt).toBe(47);
    expect(EDMONTON_FORM_PHYSICAL_PAGES).toEqual([48, 49, 50, 51, 52, 53, 54, 55]);
    expect(EDMONTON_ACROFORM_UNIQUE_FIELDS).toBe(221);
    expect(EDMONTON_WIDGETS).toBe(231);
    expect(Object.fromEntries(Object.entries(EDMONTON_FORM_WIDGETS_BY_PAGE))).toEqual({
      48: 1,
      49: 1,
      50: 1,
      51: 21,
      52: 63,
      53: 67,
      54: 49,
      55: 28
    });
    expect(Object.values(EDMONTON_FORM_WIDGETS_BY_PAGE).reduce((sum, count) => sum + count, 0)).toBe(231);
    const pageCountClaim = result.claims.find((claim) => claim.claim_id === "printed-vs-physical-pages");
    expect(pageCountClaim?.formula_and_inputs).toEqual({
      formula: "47 + 8",
      inputs: { solicitation_pages: 47, form_pages: 8 }
    });
    expect(pageCountClaim?.citations.map((citation) => citation.pdf_page_1based)).toEqual([47, 55]);
  });

  it("extracts exactly M1-M4 on physical page 43 and preserves M3's upper bound", () => {
    const mandatory = result.requirements.filter((item) => item.category === "mandatory");
    expect(mandatory.map((item) => item.id)).toEqual([
      "m1-experience",
      "m2-service-plan",
      "m3-resources",
      "m4-manufacturer"
    ]);
    expect(mandatory).toHaveLength(edmontonGolden.mandatoryCriteria);
    expect(mandatory.every((item) => item.citations.length === 1 && item.citations[0].pdf_page_1based === 43)).toBe(true);

    const m3 = mandatory.find((requirement) => requirement.id === "m3-resources");
    expect(edmontonGolden.m3MaximumResources).toBe(3);
    expect(m3?.text).toMatch(/up to three/i);
    expect(m3?.text).not.toMatch(/exactly|at least|must propose three/i);
    expect(m3?.consequence).toMatch(/not interpret 'up to three' as requiring exactly three/i);
  });

  it("uses the mandatory gate and lowest evaluated price on p14, never a 70/30 formula", () => {
    expect(result.evaluation).toMatchObject({
      mandatory_gate: true,
      rated_threshold: null,
      technical_weight: null,
      financial_weight: null,
      selection_method: "Lowest evaluated price"
    });
    expect(result.evaluation.citations.map((citation) => citation.pdf_page_1based)).toEqual([14]);
    expect(JSON.stringify(result.evaluation)).not.toMatch(/70|30|combined rating/i);
  });

  it("keeps AFR, bid-closing organization clearance, contract DOS, and personnel Reliability distinct", () => {
    const security = new Map(
      result.requirements
        .filter((item) => item.category === "security")
        .map((item) => [item.id, item])
    );
    expect([...security.keys()]).toEqual([
      "security-afr-registration",
      "security-organization",
      "security-dos-contract",
      "security-personnel"
    ]);
    expect(security.get("security-afr-registration")?.citations[0]).toMatchObject({ pdf_page_1based: 15, section: "5.2.2" });
    expect(security.get("security-organization")?.citations[0]).toMatchObject({ pdf_page_1based: 16, section: "6.1" });
    expect(security.get("security-dos-contract")?.citations[0]).toMatchObject({ pdf_page_1based: 17, section: "7.3.1" });
    expect(security.get("security-personnel")?.citations[0]).toMatchObject({ pdf_page_1based: 17, section: "7.3.1" });
    expect(security.get("security-afr-registration")?.text).toMatch(/AFR/i);
    expect(security.get("security-dos-contract")?.text).toMatch(/Designated Organization Screening \(DOS\)/i);
    expect(security.get("security-personnel")?.text).toMatch(/Reliability Status/i);
  });

  it("keeps every one of the 36 p40-p42 blank amount placeholders unknown rather than zero", () => {
    expect(edmontonGolden.pricingValue).toBeNull();
    expect(EDMONTON_PRICING_BLANK_AMOUNTS).toHaveLength(36);
    expect(
      Object.fromEntries(
        [40, 41, 42].map((page) => [
          page,
          EDMONTON_PRICING_BLANK_AMOUNTS.filter((item) => item.pdf_page_1based === page).length
        ])
      )
    ).toEqual({ 40: 14, 41: 10, 42: 12 });
    expect(EDMONTON_PRICING_BLANK_AMOUNTS.every((item) => item.value === null && item.status === "unknown")).toBe(true);
    expect(result.blocking_unknowns).toContain("Bidder-specific prices remain blank.");
    expect(JSON.stringify(EDMONTON_PRICING_BLANK_AMOUNTS)).not.toContain('"value":0');
  });

  it("detects the Annex D/E security cross-reference inconsistency", () => {
    const conflict = result.conflicts.find((item) => item.id === "conflict-security-annex-letter");
    expect(conflict?.candidate_values).toEqual(["Annex D", "Annex E"]);
    expect(conflict?.citations.map((citation) => citation.pdf_page_1based)).toEqual([17, 43]);
  });

  it("marks package completeness unverified when no amendment evidence was supplied", () => {
    expect(result.document_manifest.map((document) => document.role)).toEqual(["base"]);
    expect(result.package_completeness).toBe("unverified");
  });

  it("derives quality totals from every citation-bearing fixture item", () => {
    const groups = [
      ...result.claims.map((item) => item.citations),
      ...result.requirements.map((item) => item.citations),
      result.evaluation.citations,
      ...result.risks.map((item) => item.citations),
      ...result.conflicts.map((item) => item.citations)
    ];
    const citations = groups.flat();
    const coveredPages = new Set(
      citations.flatMap((citation) => citation.pdf_page_1based === null ? [] : [citation.pdf_page_1based])
    );
    expect(result.quality).toMatchObject({
      pages_total: EDMONTON_PAGES,
      pages_covered: coveredPages.size,
      critical_claims: groups.length,
      critical_claims_cited: groups.filter(
        (group) => group.length > 0 && group.every((citation) => citation.verified && citation.pdf_page_1based !== null)
      ).length,
      citations_verified: citations.filter((citation) => citation.verified).length,
      search_events: 0,
      follow_embedded_link_events: 0
    });
  });
});
