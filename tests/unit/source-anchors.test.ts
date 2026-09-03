import { describe, expect, it } from "vitest";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import {
  recoverMandatoryTableAnchors,
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
