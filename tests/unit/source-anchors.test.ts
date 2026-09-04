import { describe, expect, it } from "vitest";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import {
  recoverMandatoryTableAnchors,
  recoverSecurityRequirementAnchors,
  recoverSecurityChecklistConflictAnchors,
  type SourceAnchorDocument
} from "@/lib/analysis/source-anchors";
import type { PdfPageIndex } from "@/lib/pdf/page-index";

const documentSha256 = "a".repeat(64);

function draft(requirements: DraftAnalysis["requirements"] = []): DraftAnalysis {
  return {
    summary: {
      title: "",
      solicitation_number: null,
      issuer: null,
      closing_date: null,
      overview: "",
      scope: [],
      submission_method: null,
      current_selection_method: null
    },
    claims: [],
    requirements,
    evaluation: { rules: [] },
    risks: [],
    clarification_questions: [],
    blocking_unknowns: []
  };
}

function document(pages: Array<{ page: number; text: string }>): SourceAnchorDocument {
  const index: PdfPageIndex = {
    documentSha256,
    representationSha256: "b".repeat(64),
    pagesTotal: 55,
    pages: pages.map(({ page, text }) => ({
      pdfPage1Based: page,
      printedPageLabel: page <= 47 ? `${page} of 47` : null,
      text,
      normalizedText: text.toLocaleLowerCase("en-CA").replace(/\s+/g, " ").trim(),
      representationSha256: "c".repeat(64)
    })),
    chunks: [],
    embeddedJavaScriptDetected: false,
    indexVersion: "pdfjs-1based-v1"
  };
  return {
    name: "edmonton.pdf",
    sourceUrl: "https://canadabuys.canada.ca/edmonton.pdf",
    index,
    role: "base",
    amendmentNumber: null
  };
}

const annexDRelation =
  "Security Requirements Check List and security guide (if applicable), attached at Annex D;";
const annexEHeading = "ANNEX \u201cE\u201d - SECURITY REQUIREMENTS CHECK LIST";
const annexEPhysicalContext = `M4 The Bidder must provide manufacturer validation. ${annexEHeading}`;

const mandatoryTable = `
Mandatory Criteria
M1 The bidder must demonstrate they have at least 3 years of experience within the last 5 years.
M2 The bidder must provide a detailed service plan.
M3 The Bidder must propose up to three (3) resources and provide detailed resumes for each. The detailed resumes must include client names.
M4 The Bidder must provide written validation from the manufacturer.
ANNEX \u201cE\u201d - SECURITY REQUIREMENTS CHECK LIST
`;

function mandatoryRequirement(label: string, text: string): DraftAnalysis["requirements"][number] {
  return {
    id: label,
    topic: `${label} mandatory criterion`,
    document_sha256: documentSha256,
    amendment_number: null,
    effect: "add",
    category: "mandatory",
    text,
    evidence_needed: null,
    consequence: null,
    citations: [{
      document_sha256: documentSha256,
      chunk_id: null,
      evidence_quote: text,
      section: label
    }]
  };
}

describe("server-derived source anchors", () => {
  it("recovers distinct source-owned security obligations inside numbered security sections", () => {
    const recovered = recoverSecurityRequirementAnchors(draft(), [document([
      {
        page: 15,
        text: "5.2.2 Security Requirements - Required Documentation\nIn accordance with the Contract Security Program, the Bidder must provide a completed Contract Security Program Application for Registration (AFR) form at Annex F to be given further consideration in the procurement process."
      },
      {
        page: 16,
        text: "6.1 Security Requirements\nAt the date of bid closing, the Bidder must hold a valid organization security clearance as indicated in Part 7 - Resulting Contract Clauses."
      },
      {
        page: 17,
        text: "7.3 Security Requirements\n7.3.1 The following requirements apply.\nThe Contractor must, at all times during the performance of the Contract, hold a valid Designated Organization Screening (DOS), issued by the Contract Security Program.\nThe Contractor personnel requiring access to sensitive site(s) must each hold a valid Reliability Status, granted or approved by the Contract Security Program."
      }
    ])]);

    expect(recovered.map((requirement) => ({
      id: requirement.id.split("-security-").at(-1),
      page: Number(requirement.id.match(/-p(\d+)-/)?.[1]),
      category: requirement.category,
      section: requirement.citations[0].section
    }))).toEqual([
      { id: "afr-registration", page: 15, category: "security", section: "5.2.2" },
      { id: "organization-clearance", page: 16, category: "security", section: "6.1" },
      { id: "designated-organization-screening", page: 17, category: "security", section: "7.3.1" },
      { id: "personnel-reliability-status", page: 17, category: "security", section: "7.3.1" }
    ]);
    expect(recovered.every((requirement) =>
      requirement.effect === "add" && requirement.citations[0].chunk_id === null &&
      requirement.text === requirement.citations[0].evidence_quote
    )).toBe(true);
  });

  it("does not recover security phrases outside a numbered Security Requirements section", () => {
    expect(recoverSecurityRequirementAnchors(draft(), [document([{
      page: 1,
      text: "Overview: The Contractor must hold a valid Designated Organization Screening (DOS)."
    }])])).toEqual([]);
  });

  it("does not treat an inline security-section cross-reference as a heading", () => {
    expect(recoverSecurityRequirementAnchors(draft(), [document([{
      page: 1,
      text: "2.1 General Information\nRefer to 7.3 Security Requirements for details. The Contractor must, at all times during the performance of the Contract, hold a valid Designated Organization Screening (DOS), issued by the Contract Security Program."
    }])])).toEqual([]);
  });

  it("stops recovery at a same-or-shallower top-level numbered heading", () => {
    expect(recoverSecurityRequirementAnchors(draft(), [document([{
      page: 1,
      text: "2.1 Security Requirements\nThese requirements apply.\n3 Other Requirements\nThe Contractor must, at all times during the performance of the Contract, hold a valid Designated Organization Screening (DOS), issued by the Contract Security Program."
    }])])).toEqual([]);
  });

  it("stops recovery at a dotted top-level heading", () => {
    expect(recoverSecurityRequirementAnchors(draft(), [document([{
      page: 1,
      text: "2.1 Security Requirements\nThese requirements apply.\n3. Other Requirements\nThe Contractor must, at all times during the performance of the Contract, hold a valid Designated Organization Screening (DOS), issued by the Contract Security Program."
    }])])).toEqual([]);
  });

  it("does not mistake a title-cased dotted heading for an ordered-list sentence", () => {
    expect(recoverSecurityRequirementAnchors(draft(), [document([{
      page: 1,
      text: "2.1 Security Requirements\nThese requirements apply.\n3. Bidders Must Submit\nThe Contractor must, at all times during the performance of the Contract, hold a valid Designated Organization Screening (DOS), issued by the Contract Security Program."
    }])])).toEqual([]);
  });

  it("stops recovery at a non-descendant dotted section", () => {
    expect(recoverSecurityRequirementAnchors(draft(), [document([{
      page: 1,
      text: "7.3 Security Requirements\nThese requirements apply.\n7.4.1 Other Requirements\nThe Contractor must, at all times during the performance of the Contract, hold a valid Designated Organization Screening (DOS), issued by the Contract Security Program."
    }])])).toEqual([]);
  });

  it("uses the complete numbered line when a sibling clause contains the obligation", () => {
    expect(recoverSecurityRequirementAnchors(draft(), [document([{
      page: 1,
      text: "2.1 Security Requirements\nThese requirements apply.\n2.2 The Contractor must, at all times during the performance of the Contract, hold a valid Designated Organization Screening (DOS), issued by the Contract Security Program."
    }])])).toEqual([]);
  });

  it("keeps a clearly sentence-like dotted list item inside the security section", () => {
    const recovered = recoverSecurityRequirementAnchors(draft(), [document([{
      page: 1,
      text: "6.1 Security Requirements\n1. At the date of bid closing, the Bidder must hold a valid organization security clearance as indicated in Part 7."
    }])]);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].citations[0].section).toBe("6.1");
  });

  it("does not infer security amendment operations from phrase matching", () => {
    const amendment = {
      ...document([{
        page: 2,
        text: "7.3 Security Requirements The Contractor personnel must each hold a valid Reliability Status."
      }]),
      role: "amendment" as const,
      amendmentNumber: "001"
    };
    const base = document([{
      page: 1,
      text: "7.3 Security Requirements\n7.3.1 Requirements apply.\nThe Contractor must, at all times during the performance of the Contract, hold a valid Designated Organization Screening (DOS), issued by the Contract Security Program."
    }]);
    expect(recoverSecurityRequirementAnchors(draft(), [base, amendment])).toEqual([]);
  });

  it("recovers both Edmonton security-checklist annex labels from the relation and heading", () => {
    const recovered = recoverSecurityChecklistConflictAnchors(draft(), [document([
      { page: 2, text: "ANNEX \u201cE\u201d - SECURITY REQUIREMENTS CHECK LIST ............ 43" },
      { page: 17, text: `The Contractor must comply with the provisions of the: ${annexDRelation}` },
      { page: 43, text: annexEPhysicalContext }
    ])]);

    expect(recovered.map((claim) => ({
      value: claim.claim_text,
      page: Number(claim.claim_id.match(/-p(\d+)-/)?.[1]),
      quote: claim.citations[0].evidence_quote
    }))).toEqual([
      {
        value: "Annex D",
        page: 17,
        quote: `The Contractor must comply with the provisions of the: ${annexDRelation}`
      },
      { value: "Annex E", page: 43, quote: annexEPhysicalContext }
    ]);
    expect(recovered.every((claim) =>
      claim.topic === "security requirements checklist annex label" &&
      claim.claim_type === "source" && claim.effect === "add"
    )).toBe(true);
  });

  it.each([
    "If applicable, the Security Requirements Check List is attached at Annex D.",
    "The Security Requirements Check List is not attached at Annex D.",
    "Security Requirements Check List, attached at Annex D if approved.",
    "Security Requirements Check List, attached at Annex D, if approved.",
    "Subject to approval, Security Requirements Check List, attached at Annex D."
  ])("does not recover a conditional or negative annex relation: %s", (relation) => {
    const recovered = recoverSecurityChecklistConflictAnchors(draft(), [document([
      { page: 17, text: relation },
      { page: 43, text: annexEHeading }
    ])]);

    expect(recovered).toEqual([]);
  });

  it("does not recover anchors when the relation and heading agree", () => {
    const recovered = recoverSecurityChecklistConflictAnchors(draft(), [document([
      { page: 17, text: annexDRelation },
      { page: 43, text: "ANNEX \u201cD\u201d - SECURITY REQUIREMENTS CHECK LIST" }
    ])]);

    expect(recovered).toEqual([]);
  });

  it("recovers canonical table rows even when M3 is missing from the model", () => {
    const existing = [
      mandatoryRequirement("M1", "The bidder must demonstrate relevant experience."),
      mandatoryRequirement("M2", "The bidder must provide a detailed service plan."),
      mandatoryRequirement("M4", "The bidder must provide manufacturer validation.")
    ];

    const recovered = recoverMandatoryTableAnchors(draft(existing), [document([
      { page: 43, text: mandatoryTable }
    ])]);

    expect(recovered).toHaveLength(4);
    const m3 = recovered.find((item) => item.citations[0].section === "M3");
    expect(m3).toMatchObject({
      id: `server-anchor-${documentSha256.slice(0, 12)}-p43-M3`,
      category: "mandatory",
      text: "The Bidder must propose up to three (3) resources and provide detailed resumes for each",
      citations: [{ section: "M3" }]
    });
    expect(m3?.text).toContain("up to three (3)");
  });

  it("returns server anchors even when model rows exist so unverified model data cannot suppress them", () => {
    const existing = [
      mandatoryRequirement("M1", "The bidder must demonstrate relevant experience."),
      mandatoryRequirement("M2", "The bidder must provide a detailed service plan."),
      mandatoryRequirement(
        "M3",
        "The Bidder must propose up to three (3) resources and provide detailed resumes for each."
      ),
      mandatoryRequirement("M4", "The bidder must provide manufacturer validation.")
    ];

    const recovered = recoverMandatoryTableAnchors(draft(existing), [document([
      { page: 43, text: mandatoryTable }
    ])]);

    expect(recovered.map((item) => item.citations[0].section)).toEqual(["M1", "M2", "M3", "M4"]);
  });

  it("does not let an M3 resume sub-item suppress recovery of the primary bounded-resource rule", () => {
    const subItem = mandatoryRequirement("M3-client-names", "The Bidder must provide client names.");
    subItem.topic = "M3 resume client names";
    subItem.citations[0].section = "M3";

    const recovered = recoverMandatoryTableAnchors(draft([subItem]), [document([
      { page: 43, text: mandatoryTable }
    ])]);

    expect(recovered.map((item) => item.citations[0].section)).toEqual(["M1", "M2", "M3", "M4"]);
    expect(recovered.find((item) => item.citations[0].section === "M3")?.text)
      .toContain("up to three (3)");
  });

  it("does not infer add/replace semantics from an amendment table alone", () => {
    const amendment = { ...document([{ page: 5, text: mandatoryTable }]),
      role: "amendment" as const, amendmentNumber: "003" };
    expect(recoverMandatoryTableAnchors(draft(), [amendment])).toEqual([]);
  });
});
