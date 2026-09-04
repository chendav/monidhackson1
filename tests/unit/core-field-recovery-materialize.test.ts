import { describe, expect, it } from "vitest";
import type { DocumentManifest } from "@/contracts";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import { materializeAnalysis } from "@/lib/analysis/materialize";
import { sha256Hex } from "@/lib/crypto";
import { normalizeEvidenceText, type PdfPageIndex } from "@/lib/pdf/page-index";
import { verifiedFixtureSubmissionAdjudication } from "../helpers/submission-adjudication";

const baseSha = "9".repeat(64);
const amendmentSha = "8".repeat(64);
const mandatorySentence =
  "A bid must comply with the requirements of the bid solicitation and meet all mandatory technical evaluation criteria to be declared responsive.";
const selectionSentence =
  "The responsive bid with the lowest evaluated price will be recommended for award of a contract.";
const submissionClause = "send its bid only to the e-mail address specified on Page 1;";
const cover = `RETURN BIDS TO:
By Email:
rfp@example.gc.ca
REQUEST FOR PROPOSAL
Proposal To: Employment and Social Development Canada
We hereby offer to sell to Canada.
Title: Repair & Maintenance on various File Bays
Solicitation No.: 100022184-A Date:`;
const basis = `4.2 Basis of Selection
4.2.1 Mandatory Technical Criteria
${mandatorySentence} ${selectionSentence}`;
const submissionSection = `2.1.4 Submission of bids
It is the Bidder's responsibility to:
${submissionClause}`;

const quantifiedSharedPredicateClauses = ["All", "Each", "Both", "Every", "Any"]
  .flatMap((quantifier) => [
    `${quantifier} bids and bid security must be submitted through the CanadaBuys portal.`,
    `Bids and ${quantifier.toLowerCase()} bid security must be submitted through the CanadaBuys portal.`,
    `${quantifier} bid security and bids must be submitted through the CanadaBuys portal.`,
    `Bid security and ${quantifier.toLowerCase()} bids must be submitted through the CanadaBuys portal.`
  ]);

const unresolvedSharedPredicateClauses = [
  "All bids and bid security are required to be submitted through the CanadaBuys portal.",
  "Bid security and all bids are required to be submitted through the CanadaBuys portal.",
  "All bids and bid security shall both be submitted through the CanadaBuys portal.",
  "Bid security and all bids shall both be submitted through the CanadaBuys portal.",
  "All bids and bid security must each be submitted through the CanadaBuys portal.",
  "Bid security and all bids must each be submitted through the CanadaBuys portal.",
  "All bids and bid security must also be submitted through the CanadaBuys portal.",
  "Bid security and all bids must also be submitted through the CanadaBuys portal."
];

function pageIndex(sha: string, pages: Array<{ page: number; text: string }>): PdfPageIndex {
  const pageText = new Map(pages.map((page) => [page.page, page.text]));
  const pagesTotal = Math.max(...pages.map((page) => page.page));
  const completePages = Array.from({ length: pagesTotal }, (_, index) => ({
    page: index + 1,
    text: pageText.get(index + 1) ?? ""
  }));
  return {
    documentSha256: sha,
    representationSha256: sha256Hex(completePages.map((page) => page.text).join("\n")),
    pagesTotal,
    pages: completePages.map(({ page, text }) => ({
      pdfPage1Based: page,
      printedPageLabel: null,
      text,
      normalizedText: normalizeEvidenceText(text),
      representationSha256: sha256Hex(text)
    })),
    chunks: [],
    embeddedJavaScriptDetected: false,
    indexVersion: "pdfjs-1based-v1"
  };
}

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

const baseDocument = {
  name: "base.pdf",
  sourceUrl: null,
  index: pageIndex(baseSha, [
    { page: 1, text: cover },
    { page: 2, text: "Title: Project Manager" },
    { page: 6, text: submissionSection },
    { page: 14, text: basis }
  ]),
  role: "base" as const,
  amendmentNumber: null
};

const baseManifest: DocumentManifest = {
  document_id: "11111111-1111-4111-8111-111111111111",
  role: "base",
  source_type: "upload",
  source_name: "base.pdf",
  source_url: null,
  sha256: baseSha,
  pages: 14,
  language: "en",
  solicitation_number: "100022184-A",
  amendment_number: null,
  status: "active",
  cleanup_status: "deleted"
};

function materialize(draft: DraftAnalysis, amended = false) {
  const amendment = {
    name: "amendment.pdf",
    sourceUrl: null,
    index: pageIndex(amendmentSha, [{ page: 1, text: "Amendment 001" }]),
    role: "amendment" as const,
    amendmentNumber: "001"
  };
  const amendmentManifest: DocumentManifest = {
    ...baseManifest,
    document_id: "22222222-2222-4222-8222-222222222222",
    role: "amendment",
    source_name: "amendment.pdf",
    sha256: amendmentSha,
    pages: 1,
    amendment_number: "001"
  };
  const documents = amended ? [baseDocument, amendment] : [baseDocument];
  return materializeAnalysis({
    draft,
    documents,
    manifests: amended ? [baseManifest, amendmentManifest] : [baseManifest],
    costs: [],
    submissionAdjudication: verifiedFixtureSubmissionAdjudication(documents, (candidate) =>
      candidate.pdf_page_1based === 6 &&
        candidate.occurrences.some((occurrence) => occurrence.channel_hint === "email")
        ? [{
            evidenceText: submissionClause,
            subjectScope: "whole_bid",
            modality: "required",
            channel: "email"
          }]
        : undefined,
    { defaultOccurrenceDisposition: "other" }),
    generatedAt: new Date("2026-09-03T00:00:00.000Z"),
    expiresAt: new Date("2026-09-04T00:00:00.000Z")
  }).result;
}

describe("materialized closed-template core fields", () => {
  it("publishes only verified cover and Basis of Selection fields with physical pages", () => {
    const result = materialize(emptyDraft());

    expect(result.summary).toMatchObject({
      title: "Repair & Maintenance on various File Bays",
      solicitation_number: "100022184-A",
      issuer: "Employment and Social Development Canada",
      submission_method: "Email",
      current_selection_method: "Lowest evaluated price"
    });
    expect(result.evaluation).toMatchObject({
      mandatory_gate: true,
      rated_threshold: null,
      technical_weight: null,
      financial_weight: null,
      selection_method: "Lowest evaluated price"
    });
    expect(result.evaluation.citations.map((citation) => citation.pdf_page_1based))
      .toEqual([14, 14]);
    expect(result.claims.filter((claim) => claim.claim_id.includes("-cover-"))
      .every((claim) => claim.citations[0].pdf_page_1based === 1)).toBe(true);
    expect(result.claims.find((claim) => claim.claim_text === "Email")?.citations[0])
      .toMatchObject({ pdf_page_1based: 6, section: "2.1.4" });
  });

  it("keeps non-submission anchors but lets an unbound model channel veto submission", () => {
    const draft = emptyDraft();
    draft.summary = {
      ...draft.summary,
      title: "Invented title",
      solicitation_number: "WRONG-1",
      issuer: "Invented issuer",
      submission_method: "Portal",
      current_selection_method: "Highest combined rating"
    };
    draft.evaluation.rules.push({
      id: `server-anchor-${baseSha.slice(0, 12)}-p14-evaluation-selection-method`,
      topic: "award selection method",
      field: "selection_method",
      value: "Highest combined rating",
      document_sha256: baseSha,
      amendment_number: null,
      effect: "add",
      citations: [{
        document_sha256: baseSha,
        chunk_id: null,
        evidence_quote: selectionSentence,
        section: "4.2.1"
      }]
    });
    draft.claims.push({
      claim_id: "model-body-title",
      topic: "tender name",
      claim_text: "Project Manager",
      claim_type: "source",
      confidence: 1,
      document_sha256: baseSha,
      amendment_number: null,
      effect: "add",
      citations: [{
        document_sha256: baseSha,
        chunk_id: null,
        evidence_quote: "Title: Project Manager",
        section: "Staffing"
      }],
      supersedes_claim_ids: []
    });

    const result = materialize(draft);
    expect(result.summary).toMatchObject({
      title: "Repair & Maintenance on various File Bays",
      solicitation_number: "100022184-A",
      issuer: "Employment and Social Development Canada",
      submission_method: null,
      current_selection_method: "Lowest evaluated price"
    });
    expect(result.evaluation.selection_method).toBe("Lowest evaluated price");
    expect(result.claims.some((claim) => claim.claim_text === "Project Manager")).toBe(false);
    expect(result.quality.unsupported_items_removed).toBeGreaterThanOrEqual(1);
  });

  it("withholds the summary channel when another verified whole-bid channel conflicts", () => {
    const portalClause = "Bids must be submitted through the CanadaBuys portal.";
    const document = {
      ...baseDocument,
      index: pageIndex(baseSha, [
        { page: 1, text: cover },
        { page: 2, text: portalClause },
        { page: 6, text: submissionSection },
        { page: 14, text: basis }
      ])
    };
    const draft = emptyDraft();
    draft.claims.push({
      claim_id: "portal-submission",
      topic: "submission method portal",
      document_sha256: baseSha,
      amendment_number: null,
      effect: "add",
      claim_text: "Portal",
      claim_type: "source",
      confidence: 1,
      citations: [{
        document_sha256: baseSha,
        chunk_id: null,
        evidence_quote: portalClause,
        section: "Submission"
      }],
      supersedes_claim_ids: []
    });
    const result = materializeAnalysis({
      draft,
      documents: [document],
      manifests: [baseManifest],
      costs: [],
      expiresAt: new Date("2026-09-04T00:00:00.000Z")
    }).result;

    expect(result.summary.submission_method).toBeNull();
  });

  it.each([
    ["Bids must use electronic signatures.", "Electronic submission"],
    ["Bids must use electronic document naming conventions.", "Electronic submission"],
    ["Bids must use email encryption.", "Email"],
    ["Bids must use electronic signatures for submission.", "Electronic submission"],
    ["Bids must use electronic document naming conventions for submission.", "Electronic submission"],
    ["Bids must use email encryption for submission.", "Email"],
    ["Bids must include an email proposal template.", "Email"],
    ["Bids must attach an email submission checklist.", "Email"],
    ["Bids must describe the email proposal process.", "Email"],
    [
      "Bids must include instructions that subcontractors shall email proposals to clients.",
      "Email"
    ],
    [
      "Bids must identify the employee who will email proposals to prospective clients.",
      "Email"
    ],
    [
      "Bids must explain whether vendors shall email proposals to subcontractors.",
      "Email"
    ]
  ] as const)("does not publish a non-delivery use requirement as a channel: %s", (
    clause,
    claimedMethod
  ) => {
    const document = {
      ...baseDocument,
      index: pageIndex(baseSha, [{ page: 2, text: clause }])
    };
    const draft = emptyDraft();
    draft.summary.submission_method = claimedMethod;
    draft.claims.push({
      claim_id: "non-delivery-use",
      topic: "submission method",
      document_sha256: baseSha,
      amendment_number: null,
      effect: "add",
      claim_text: claimedMethod,
      claim_type: "source",
      confidence: 1,
      citations: [{
        document_sha256: baseSha,
        chunk_id: null,
        evidence_quote: clause,
        section: "Formatting"
      }],
      supersedes_claim_ids: []
    });

    const result = materializeAnalysis({
      draft,
      documents: [document],
      manifests: [baseManifest],
      costs: [],
      expiresAt: new Date("2026-09-04T00:00:00.000Z")
    }).result;

    expect(result.claims.find((claim) => claim.claim_id === "non-delivery-use")?.status)
      .toBe("needs_review");
    expect(result.summary.submission_method).toBeNull();
  });

  it("continues to publish use when the evidence states its submission purpose", () => {
    const clause = "Bids must use the CanadaBuys portal for submission.";
    const document = {
      ...baseDocument,
      index: pageIndex(baseSha, [{ page: 2, text: clause }])
    };
    const draft = emptyDraft();
    draft.summary.submission_method = "Portal";
    draft.claims.push({
      claim_id: "explicit-submission-use",
      topic: "submission method portal",
      document_sha256: baseSha,
      amendment_number: null,
      effect: "add",
      claim_text: "Portal",
      claim_type: "source",
      confidence: 1,
      citations: [{
        document_sha256: baseSha,
        chunk_id: null,
        evidence_quote: clause,
        section: "Submission"
      }],
      supersedes_claim_ids: []
    });

    const result = materializeAnalysis({
      draft,
      documents: [document],
      manifests: [baseManifest],
      costs: [],
      submissionAdjudication: verifiedFixtureSubmissionAdjudication([document], (candidate) =>
        candidate.occurrences.some((occurrence) => occurrence.channel_hint === "portal")
          ? [{
              evidenceText: clause,
              subjectScope: "whole_bid",
              modality: "required",
              channel: "portal"
            }]
          : undefined,
      { defaultOccurrenceDisposition: "other" }),
      expiresAt: new Date("2026-09-04T00:00:00.000Z")
    }).result;

    expect(result.claims.find((claim) => claim.claim_id === "explicit-submission-use")?.status)
      .toBe("needs_review");
    expect(result.summary.submission_method).toBe("Portal");
  });

  it.each([
    ["Bids may be submitted through the CanadaBuys portal.", "needs_review"],
    ["Bids can be submitted through the CanadaBuys portal.", "needs_review"],
    [
      "Bids submitted through the CanadaBuys portal will be rejected if received after closing.",
      "needs_review"
    ],
    [
      "Bids submitted through the CanadaBuys portal will be rejected if infected.",
      "needs_review"
    ],
    [
      "Bids must be submitted through the CanadaBuys portal not later than 2 p.m.",
      "needs_review"
    ],
    [
      "Bids must not be submitted through the CanadaBuys portal after the closing date.",
      "needs_review"
    ]
  ] as const)(
    "uses verified non-prohibited Portal evidence as ambiguity without over-publishing: %s",
    (portalClause, expectedClaimStatus) => {
      const document = {
        ...baseDocument,
        index: pageIndex(baseSha, [
          { page: 1, text: cover },
          { page: 2, text: portalClause },
          { page: 6, text: submissionSection },
          { page: 14, text: basis }
        ])
      };
      const draft = emptyDraft();
      draft.summary.submission_method = "Portal";
      draft.claims.push({
        claim_id: "portal-ambiguity",
        topic: "submission method portal",
        document_sha256: baseSha,
        amendment_number: null,
        effect: "add",
        claim_text: "Portal",
        claim_type: "source",
        confidence: 1,
        citations: [{
          document_sha256: baseSha,
          chunk_id: null,
          evidence_quote: portalClause,
          section: "Other instructions"
        }],
        supersedes_claim_ids: []
      });

      const result = materializeAnalysis({
        draft,
        documents: [document],
        manifests: [baseManifest],
        costs: [],
        expiresAt: new Date("2026-09-04T00:00:00.000Z")
      }).result;

      expect(result.claims.find((claim) => claim.claim_id === "portal-ambiguity")?.status)
        .toBe(expectedClaimStatus);
      expect(result.summary.submission_method).toBeNull();
    }
  );

  it.each([
    "Bids must be submitted through the CanadaBuys portal and questions may be sent by email.",
    "Bids must be submitted through the CanadaBuys portal and bid security must be sent by email.",
    "Bids and bid security must be submitted through the CanadaBuys portal.",
    "Bid security and bids must be submitted through the CanadaBuys portal.",
    "Bids and questions must be submitted through the CanadaBuys portal.",
    "Questions and bids must be submitted through the CanadaBuys portal.",
    "Bids must be submitted by email and through the CanadaBuys portal.",
    "Bids must be submitted through the\nCanadaBuys portal.",
    "Bids and bid security\nare required to be submitted through the CanadaBuys portal.",
    ...quantifiedSharedPredicateClauses,
    ...unresolvedSharedPredicateClauses
  ])("prevents false Email uniqueness from rejected coordinated evidence: %s", (clause) => {
    const document = {
      ...baseDocument,
      index: pageIndex(baseSha, [
        { page: 1, text: cover },
        { page: 2, text: clause },
        { page: 6, text: submissionSection },
        { page: 14, text: basis }
      ])
    };
    const draft = emptyDraft();
    draft.summary.submission_method = "Email";
    draft.claims.push({
      claim_id: "rejected-coordinated-email",
      topic: "submission method email",
      document_sha256: baseSha,
      amendment_number: null,
      effect: "add",
      claim_text: "Email",
      claim_type: "source",
      confidence: 1,
      citations: [{
        document_sha256: baseSha,
        chunk_id: null,
        evidence_quote: clause,
        section: "Other instructions"
      }],
      supersedes_claim_ids: []
    });

    const result = materializeAnalysis({
      draft,
      documents: [document],
      manifests: [baseManifest],
      costs: [],
      expiresAt: new Date("2026-09-04T00:00:00.000Z")
    }).result;

    expect(result.claims.find((claim) =>
      claim.claim_id === "rejected-coordinated-email"
    )?.status).toBe("needs_review");
    expect(result.summary.submission_method).toBeNull();
  });

  it.each([
    ["Bids submitted by facsimile will not be accepted.", "Fax"],
    ["Bids must not be submitted through the CanadaBuys portal.", "Portal"]
  ] as const)("keeps a verified different-channel Agent prohibition compatible: %s", (clause, value) => {
    const document = {
      ...baseDocument,
      index: pageIndex(baseSha, [
        { page: 1, text: cover },
        { page: 2, text: clause },
        { page: 6, text: submissionSection },
        { page: 14, text: basis }
      ])
    };
    const draft = emptyDraft();

    const result = materializeAnalysis({
      draft,
      documents: [document],
      manifests: [baseManifest],
      costs: [],
      submissionAdjudication: verifiedFixtureSubmissionAdjudication([document], (candidate) => {
        if (candidate.pdf_page_1based === 6 &&
          candidate.occurrences.some((occurrence) => occurrence.channel_hint === "email")) {
          return [{
            evidenceText: submissionClause,
            subjectScope: "whole_bid",
            modality: "required",
            channel: "email"
          }];
        }
        const prohibitedOccurrence = candidate.pdf_page_1based === 2
          ? candidate.occurrences.find((occurrence) => occurrence.channel_hint ===
              (value === "Fax" ? "fax" : "portal"))
          : undefined;
        if (prohibitedOccurrence) {
          return [{
            evidenceText: clause,
            subjectScope: "whole_bid",
            modality: "prohibited",
            channel: prohibitedOccurrence.channel_hint
          }];
        }
        return undefined;
      }, { defaultOccurrenceDisposition: "other" }),
      expiresAt: new Date("2026-09-04T00:00:00.000Z")
    }).result;

    expect(result.summary.submission_method).toBe("Email");
  });

  it("withholds stale recovered fields while retaining fully adjudicated unchanged submission evidence", () => {
    const result = materialize(emptyDraft(), true);
    expect(result.summary).toMatchObject({
      title: "Document-only RFP analysis",
      solicitation_number: null,
      issuer: null,
      submission_method: "Email",
      current_selection_method: null
    });
    expect(result.evaluation).toMatchObject({
      mandatory_gate: null,
      selection_method: null
    });
  });
});
