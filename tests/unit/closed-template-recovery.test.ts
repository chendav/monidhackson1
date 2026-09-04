import { describe, expect, it } from "vitest";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import {
  recoverBasisOfSelectionEvaluationAnchors,
  recoverSubmissionMethodAnchors,
  recoverStrictCoverAnchors,
  type SourceAnchorDocument
} from "@/lib/analysis/source-anchors";
import type { PdfPageIndex } from "@/lib/pdf/page-index";

const documentSha256 = "d".repeat(64);

function emptyDraft(): DraftAnalysis {
  return {
    summary: {
      title: "", solicitation_number: null, issuer: null, closing_date: null,
      overview: "", scope: [], submission_method: null, current_selection_method: null
    },
    claims: [], requirements: [], evaluation: { rules: [] }, risks: [],
    clarification_questions: [], blocking_unknowns: []
  };
}

function sourceDocument(
  pages: Array<{ page: number; text: string }>,
  role: "base" | "amendment" = "base"
): SourceAnchorDocument {
  const index: PdfPageIndex = {
    documentSha256,
    representationSha256: "e".repeat(64),
    pagesTotal: pages.length,
    pages: pages.map(({ page, text }) => ({
      pdfPage1Based: page,
      printedPageLabel: null,
      text,
      normalizedText: text.toLocaleLowerCase("en-CA").replace(/\s+/g, " ").trim(),
      representationSha256: "f".repeat(64)
    })),
    chunks: [], embeddedJavaScriptDetected: false, indexVersion: "pdfjs-1based-v1"
  };
  return {
    name: `${role}.pdf`, sourceUrl: null, index, role,
    amendmentNumber: role === "amendment" ? "001" : null
  };
}

const strictCover = `Request for Proposal: 100022184
Page 1 of 47
RETURN BIDS TO:
By Email:
rfp@example.gc.ca
(Size limit - 13MB)
REQUEST FOR PROPOSAL
Proposal To: Employment and Social
Development Canada
We hereby offer to sell to Canada, in accordance with the terms set out herein.
Instructions: See Herein
Title: Repair & Maintenance on various File Bays
Solicitation No.: 100022184-A   Date:
2023-06-05`;

const mandatorySentence =
  "A bid must comply with the requirements of the bid solicitation and meet all mandatory technical evaluation criteria to be declared responsive.";
const selectionSentence =
  "The responsive bid with the lowest evaluated price will be recommended for award of a contract.";
const strictBasis = `PART 4 - EVALUATION PROCEDURES AND BASIS OF SELECTION
4.1 Evaluation Procedures
Bids will be evaluated.
4.2 Basis of Selection
4.2.1 Mandatory Technical Criteria
${mandatorySentence} ${selectionSentence}`;

describe("closed-template non-semantic source recovery", () => {
  it("recovers exact, source-owned cover fields from the strict page-one template", () => {
    const claims = recoverStrictCoverAnchors(emptyDraft(), [sourceDocument([
      { page: 1, text: strictCover },
      { page: 2, text: "Title: Project Manager" }
    ])]);
    expect(Object.fromEntries(claims.map((claim) => [claim.topic, claim.claim_text]))).toEqual({
      "solicitation title": "Repair & Maintenance on various File Bays",
      "solicitation number": "100022184-A",
      issuer: "Employment and Social Development Canada"
    });
    expect(claims.every((claim) => claim.document_sha256 === documentSha256 &&
      claim.citations[0].evidence_quote.length <= 500)).toBe(true);
  });

  it("never borrows a cover from another physical page or an amended package", () => {
    expect(recoverStrictCoverAnchors(emptyDraft(), [sourceDocument([
      { page: 2, text: strictCover }
    ])])).toEqual([]);
    expect(recoverStrictCoverAnchors(emptyDraft(), [sourceDocument([
      { page: 1, text: strictCover }
    ], "amendment")])).toEqual([]);
  });

  it("keeps submission source recovery non-authoritative for every English variant", () => {
    const variants = [
      "Bids must be submitted by email.",
      "Bids may be submitted through the CanadaBuys portal.",
      "Bids cannot be submitted by fax.",
      "Questions about bids may be sent by email.",
      "All bids and bid security are required to be submitted through Portal.",
      "Bids must be submitted by email and through the portal."
    ];
    for (const variant of variants) {
      expect(recoverSubmissionMethodAnchors(emptyDraft(), [sourceDocument([{
        page: 6,
        text: `2.1.4 Submission of bids\n${variant}`
      }])])).toEqual([]);
    }
  });

  it("recovers only the two closed evaluation rules from one bounded section", () => {
    const rules = recoverBasisOfSelectionEvaluationAnchors(emptyDraft(), [sourceDocument([
      { page: 13, text: "70% technical merit and 30% price." },
      { page: 14, text: strictBasis },
      { page: 15, text: "4.3 Other material" }
    ])]);
    expect(rules.map((rule) => ({ field: rule.field, value: rule.value }))).toEqual([
      { field: "mandatory_gate", value: "true" },
      { field: "selection_method", value: "Lowest evaluated price" }
    ]);
    expect(rules.every((rule) => rule.document_sha256 === documentSha256 &&
      rule.citations[0].evidence_quote.length <= 500 &&
      !/70%|30%|combined rating/i.test(rule.citations[0].evidence_quote))).toBe(true);
  });

  it("does not join an incomplete selection sentence across pages and disables amended packages", () => {
    const split = sourceDocument([
      { page: 14, text: strictBasis.replace(selectionSentence, "The responsive bid with the") },
      { page: 15, text: "lowest evaluated price will be recommended for award of a contract." }
    ]);
    expect(recoverBasisOfSelectionEvaluationAnchors(emptyDraft(), [split]).map((rule) => rule.field))
      .toEqual(["mandatory_gate"]);
    expect(recoverBasisOfSelectionEvaluationAnchors(emptyDraft(), [
      sourceDocument([{ page: 14, text: strictBasis }]),
      sourceDocument([{ page: 1, text: "Amendment 001" }], "amendment")
    ])).toEqual([]);
  });
});
