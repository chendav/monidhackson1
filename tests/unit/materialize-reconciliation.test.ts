import { describe, expect, it } from "vitest";
import type { Citation, DocumentManifest } from "@/contracts";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import { materializeAnalysis, resolveRiskLineage } from "@/lib/analysis/materialize";
import { reconcileVersionedFacts } from "@/lib/analysis/reconciliation";
import { sha256Hex } from "@/lib/crypto";
import { normalizeEvidenceText, type PdfPageIndex } from "@/lib/pdf/page-index";

function index(sha: string, pages: string[]): PdfPageIndex {
  return {
    documentSha256: sha,
    representationSha256: sha256Hex(pages.join("\n")),
    pagesTotal: pages.length,
    pages: pages.map((text, offset) => ({
      pdfPage1Based: offset + 1,
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

const baseSha = "a".repeat(64);
const amendmentSha = "b".repeat(64);
const baseIndex = index(baseSha, [
  "Contract end date 2045.",
  "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant.",
  "The ratio is 70% for technical merit and 30% for price. Selection uses the highest combined rating.",
  "Bidders must obtain a minimum score of fifty (50) points on a scale of ninety-four (94) points.",
  "RFP title: Real Contract. Issuer: Fake Corp. Issuer: Canada. Solicitation number: CER-1. " +
    "Closing date: September 15, 2026 at 14:00 -06:00. " +
    "Closing date: September 15, 2026 at 14:00 MDT. Questions are due September 15, 2026 at 14:00 EST."
]);
const amendmentIndex = index(amendmentSha, [
  "cover", "Amendment replaces the contract end date with 2050.", "three", "four",
  "Amendment replaces the contract end date with 2055.", "The amendment repeats the replacement 2055 end date.",
  "The amended ratio is 60% for technical merit and 40% for price.",
  "The old contract term is deleted."
]);
const manifests: DocumentManifest[] = [
  {
    document_id: crypto.randomUUID(), role: "base", source_type: "upload", source_name: "base.pdf",
    source_url: null, sha256: baseSha, pages: 1, language: "en", solicitation_number: "CER-1",
    amendment_number: null, status: "active", cleanup_status: "deleted"
  },
  {
    document_id: crypto.randomUUID(), role: "amendment", source_type: "upload", source_name: "a003.pdf",
    source_url: null, sha256: amendmentSha, pages: 6, language: "en", solicitation_number: "CER-1",
    amendment_number: "003", status: "active", cleanup_status: "deleted"
  }
];

function draft(requirements: DraftAnalysis["requirements"]): DraftAnalysis {
  return {
    summary: {
      title: "Unsupported title", solicitation_number: "invented", issuer: "invented issuer",
      closing_date: "tomorrow", overview: "invented overview", scope: ["invented scope"],
      submission_method: "telepathy", current_selection_method: "guess"
    },
    claims: [], requirements,
    evaluation: { rules: [] },
    risks: [], clarification_questions: [], blocking_unknowns: []
  };
}

const citation = (document_sha256: string, evidence_quote: string) => ({
  document_sha256, chunk_id: null, evidence_quote, section: "Term"
});

function verifiedCitation(
  document_sha256: string,
  evidence_quote: string,
  pdf_page_1based = 1
): Citation {
  return {
    document_sha256,
    document_name: "source.pdf",
    source_url: null,
    pdf_page_1based,
    printed_page_label: null,
    section: null,
    evidence_quote,
    verified: true,
    verification_method: "exact"
  };
}

function addMinimumCoverage(value: DraftAnalysis) {
  value.requirements.push({
    id: "signed-form", topic: "signed form requirement", document_sha256: baseSha,
    amendment_number: null, effect: "add", category: "mandatory",
    text: "The bidder must submit a signed form.", evidence_needed: null, consequence: null,
    citations: [citation(baseSha, "The bidder must submit a signed form.")]
  });
  value.evaluation.rules.push({
    id: "mandatory-gate", field: "mandatory_gate", topic: "mandatory gate",
    document_sha256: baseSha, amendment_number: null, effect: "add", value: "true",
    citations: [citation(baseSha, "A bid that fails a mandatory requirement will be non-compliant.")]
  });
  return value;
}

describe("server-owned materialization and reconciliation", () => {
  it("reconciles requirements independently, ignores model amendment numbers, and keeps current-stage conflict evidence", () => {
    const result = materializeAnalysis({
      draft: draft([
        {
          id: "term-base", topic: "contract end date", document_sha256: baseSha,
          amendment_number: null, effect: "add", category: "contractual",
          text: "Contract end date 2045.", evidence_needed: null, consequence: null,
          citations: [citation(baseSha, "Contract end date 2045.")]
        },
        {
          id: "term-2050", topic: "contract end date", document_sha256: amendmentSha,
          amendment_number: "999", effect: "replace", category: "contractual",
          text: "Contract end date 2050.", evidence_needed: null, consequence: null,
          citations: [citation(amendmentSha, "Amendment replaces the contract end date with 2050.")]
        },
        {
          id: "term-2055", topic: "contract end date", document_sha256: amendmentSha,
          amendment_number: "001", effect: "replace", category: "contractual",
          text: "Contract end date 2055.", evidence_needed: null, consequence: null,
          citations: [
            citation(amendmentSha, "Amendment replaces the contract end date with 2055."),
            citation(amendmentSha, "The amendment repeats the replacement 2055 end date.")
          ]
        }
      ]),
      documents: [
        { name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null },
        { name: "a003.pdf", sourceUrl: null, index: amendmentIndex, role: "amendment", amendmentNumber: "003" }
      ],
      manifests,
      costs: [],
      generatedAt: new Date("2026-09-02T00:00:00Z"),
      expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.package_completeness).toBe("incomplete");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].safe_answer)
      .toBe("The supplied amendment is internally inconsistent; clarification is required.");
    expect(result.conflicts[0].citations.map((item) => item.pdf_page_1based)).toEqual([2, 5, 6]);
    expect(result.requirements.find((item) => item.id === "term-base")?.status).toBe("superseded");
    expect(result.summary).toMatchObject({
      title: "Document-only RFP analysis", solicitation_number: null, issuer: null,
      closing_date: null, scope: [], submission_method: null, current_selection_method: null
    });
    expect(result.decision_readiness).toBe("incomplete");
  });

  it("treats deletes as non-visible tombstones and empty extraction as incomplete", () => {
    const reconciliation = reconcileVersionedFacts([
      { id: "old", topic: "insurance", value: "$5m", documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add", citations: [verifiedCitation(baseSha, "Insurance is $5m.")] },
      { id: "delete", topic: "insurance", value: "delete insurance", documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "003", effect: "delete", citations: [] }
    ]);
    expect(reconciliation.facts.find((item) => item.id === "old")?.status).toBe("active");
    expect(reconciliation.facts.find((item) => item.id === "delete")?.status).toBe("superseded");

    const result = materializeAnalysis({
      draft: draft([]),
      documents: [{ name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.package_completeness).toBe("unverified");
    expect(result.decision_readiness).toBe("incomplete");
    expect(result.quality.critical_claims_cited).toBe(0);
    expect(result.blocking_unknowns).toContain("No substantive source-backed analysis could be verified.");
  });

  it("withholds OCR text that cannot be bound to the native physical-page index", () => {
    const ocrDraft = addMinimumCoverage(draft([]));
    const imageOnlyIndex = index(baseSha, [""]);
    const result = materializeAnalysis({
      draft: ocrDraft,
      documents: [{
        name: "image-only.pdf",
        sourceUrl: null,
        index: imageOnlyIndex,
        role: "base",
        amendmentNumber: null
      }],
      manifests: [{ ...manifests[0], source_name: "image-only.pdf", pages: 1 }],
      costs: [],
      expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.requirements.find((item) => item.id === "signed-form")).toBeUndefined();
    expect(result.evaluation.mandatory_gate).toBeNull();
    expect(result.quality.citations_verified).toBe(0);
    expect(result.decision_readiness).toBe("incomplete");
    expect(result.blocking_unknowns).toContain("No substantive source-backed analysis could be verified.");
  });

  it("accounts for the selected private-storage provider without hardcoding Railway", () => {
    const result = materializeAnalysis({
      draft: draft([]),
      documents: [{ name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]],
      costs: [],
      storageProvider: "vercel_blob",
      expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.costs.unpriced_providers).toContain("vercel_blob");
    expect(result.costs.unpriced_providers).not.toContain("railway_s3");
    expect(result.costs.not_applicable_providers).toEqual(["railway_s3"]);
  });

  it("does not treat an uncited unknown as substantive evidence", () => {
    const unknownOnly = draft([]);
    unknownOnly.claims = [{
      claim_id: "unknown-budget",
      topic: "contract value",
      claim_text: "Contract value is not stated.",
      claim_type: "unknown",
      confidence: 1,
      document_sha256: baseSha,
      amendment_number: null,
      effect: "add",
      citations: [],
      supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: unknownOnly,
      documents: [{ name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.claims).toHaveLength(1);
    expect(result.decision_readiness).toBe("incomplete");
    expect(result.blocking_unknowns).toContain("No substantive source-backed analysis could be verified.");
  });

  it("does not publish a non-unknown review claim when no citation matches the source", () => {
    const value = addMinimumCoverage(draft([]));
    value.claims = [{
      claim_id: "unmatched-source-claim",
      topic: "contract value",
      claim_text: "The contract value is 5000000 CAD.",
      claim_type: "source",
      confidence: 1,
      document_sha256: baseSha,
      amendment_number: null,
      effect: "add",
      citations: [citation(baseSha, "This sentence is absent from the physical PDF page.")],
      supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{
        name: "base.pdf", sourceUrl: null, index: baseIndex,
        role: "base", amendmentNumber: null
      }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.claims.find((claim) => claim.claim_id === "unmatched-source-claim"))
      .toBeUndefined();
    expect(result.quality.unsupported_items_removed).toBeGreaterThanOrEqual(1);
    expect(result.quality.critical_claims).toBe(result.quality.critical_claims_cited);
  });

  it("measures citation coverage over the published fact groups only", () => {
    const value = addMinimumCoverage(draft([]));
    value.claims = [{
      claim_id: "verified-term",
      topic: "contract end date",
      claim_text: "Contract end date 2045.",
      claim_type: "source",
      confidence: 1,
      document_sha256: baseSha,
      amendment_number: null,
      effect: "add",
      citations: [citation(baseSha, "Contract end date 2045.")],
      supersedes_claim_ids: []
    }];
    value.requirements.push({
      id: "rejected-requirement",
      topic: "unsupported delivery window",
      document_sha256: baseSha,
      amendment_number: null,
      effect: "add",
      category: "delivery",
      text: "Delivery is required within 99 days.",
      evidence_needed: null,
      consequence: null,
      citations: [citation(baseSha, "This requirement is absent from the physical PDF page.")]
    });
    const result = materializeAnalysis({
      draft: value,
      documents: [{
        name: "base.pdf", sourceUrl: null,
        index: index(baseSha, [
          "Contract end date 2045.",
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."
        ]),
        role: "base", amendmentNumber: null
      }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    const groups = [
      ...result.claims.filter((claim) => claim.claim_type !== "unknown").map((claim) => claim.citations),
      ...result.requirements.map((requirement) => requirement.citations),
      result.evaluation.citations,
      ...result.risks.map((risk) => risk.citations),
      ...result.conflicts.map((conflict) => conflict.citations)
    ];

    expect(result.quality.critical_claims).toBe(groups.length);
    expect(result.quality.critical_claims_cited).toBe(groups.length);
    expect(groups.every((citations) => citations.length > 0 && citations.every((citation) =>
      citation.verified && citation.pdf_page_1based !== null
    ))).toBe(true);
    expect(result.quality.unsupported_items_removed).toBeGreaterThanOrEqual(1);
  });

  it("keeps an unknown replacement out of reconciliation and marks it for clarification", () => {
    const value = addMinimumCoverage(draft([]));
    value.claims = [
      {
        claim_id: "known-term", topic: "contract end date", claim_text: "Contract end date 2045.",
        claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
        effect: "add", citations: [citation(baseSha, "Contract end date 2045.")], supersedes_claim_ids: []
      },
      {
        claim_id: "unknown-term", topic: "contract end date", claim_text: "The amended end date is unknown.",
        claim_type: "unknown", confidence: 1, document_sha256: amendmentSha, amendment_number: "003",
        effect: "replace", citations: [], supersedes_claim_ids: ["known-term"]
      }
    ];
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null },
        { name: "a003.pdf", sourceUrl: null, index: amendmentIndex, role: "amendment", amendmentNumber: "003" }
      ],
      manifests, costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.claims.find((claim) => claim.claim_id === "known-term")?.status).toBe("active");
    expect(result.claims.find((claim) => claim.claim_id === "unknown-term")?.status).toBe("needs_review");
    expect(result.blocking_unknowns).toContain(
      "One or more extracted facts remain unknown and cannot replace source-backed facts."
    );
  });

  it("marks mismatched numbers, dates, and cross-document citations as needs_review", () => {
    const value = addMinimumCoverage(draft([]));
    value.claims = [
      {
        claim_id: "wrong-year", topic: "contract end date", claim_text: "Contract end date 2055.",
        claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
        effect: "add", citations: [citation(baseSha, "Contract end date 2045.")], supersedes_claim_ids: []
      },
      {
        claim_id: "wrong-date", topic: "closing date", claim_text: "Closing date: 2026-09-03.",
        claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
        effect: "add", citations: [citation(baseSha, "Closing date: September 15, 2026.")], supersedes_claim_ids: []
      },
      {
        claim_id: "wrong-document", topic: "amended end date", claim_text: "Contract end date 2055.",
        claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
        effect: "replace", citations: [citation(amendmentSha, "Contract end date 2055.")], supersedes_claim_ids: []
      }
    ];
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null },
        { name: "a003.pdf", sourceUrl: null, index: amendmentIndex, role: "amendment", amendmentNumber: "003" }
      ],
      manifests, costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.claims.map((claim) => [claim.claim_id, claim.status])).toEqual([
      ["wrong-year", "needs_review"]
    ]);
    expect(result.claims.find((claim) => claim.claim_id === "wrong-date")).toBeUndefined();
    expect(result.claims.find((claim) => claim.claim_id === "wrong-document")).toBeUndefined();
    expect(result.quality.unsupported_items_removed).toBeGreaterThanOrEqual(3);
  });

  it("does not launder an issuer citation into a title or another summary field", () => {
    const value = addMinimumCoverage(draft([]));
    value.summary.title = "Canada";
    value.summary.issuer = "Canada";
    value.claims = [
      {
        claim_id: "false-title", topic: "RFP title", claim_text: "Canada",
        claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
        effect: "add", citations: [citation(baseSha, "Issuer: Canada.")], supersedes_claim_ids: []
      },
      {
        claim_id: "issuer", topic: "contracting authority issuer", claim_text: "Canada",
        claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
        effect: "add", citations: [citation(baseSha, "Issuer: Canada.")], supersedes_claim_ids: []
      }
    ];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.summary.title).toBe("Document-only RFP analysis");
    expect(result.summary.issuer).toBe("Canada");

    const sharedQuote = "RFP title: Correct Tender. Issuer: Canada.";
    const sharedIndex = index(baseSha, [sharedQuote,
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
    const drifted = addMinimumCoverage(draft([]));
    drifted.summary.title = "Title is Canada.";
    drifted.claims = [{
      claim_id: "drifted-title", topic: "administrative information", claim_text: "Title is Canada.",
      claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
      effect: "add", citations: [citation(baseSha, sharedQuote)], supersedes_claim_ids: []
    }];
    const driftedResult = materializeAnalysis({
      draft: drifted,
      documents: [{ name: "base.pdf", sourceUrl: null, index: sharedIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(driftedResult.claims[0]?.status).toBe("needs_review");
    expect(driftedResult.summary.title).toBe("Document-only RFP analysis");
  });

  it("does not bind a questions email address to the submission method", () => {
    const quote = "Submission method: portal. Questions may be sent by email.";
    const scopedIndex = index(baseSha, [quote,
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
    const value = addMinimumCoverage(draft([]));
    value.summary.submission_method = "Submission method is email.";
    value.claims = [{
      claim_id: "submission", topic: "administrative information", claim_text: "Submission method is email.",
      claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
      effect: "add", citations: [citation(baseSha, quote)], supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: scopedIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.claims.find((claim) => claim.claim_id === "submission")?.status).toBe("needs_review");
    expect(result.summary.submission_method).toBeNull();

    const mixedQuote = "Submission method: bids must be emailed to tenders@example.ca, " +
      "while monthly invoices must be submitted through the CanadaBuys portal.";
    const mixedIndex = index(baseSha, [mixedQuote,
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
    const mixed = addMinimumCoverage(draft([]));
    mixed.summary.submission_method = "CanadaBuys portal";
    mixed.claims = [{
      claim_id: "invoice-portal", topic: "submission method", claim_text: "CanadaBuys portal",
      claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
      effect: "add", citations: [citation(baseSha, mixedQuote)], supersedes_claim_ids: []
    }];
    const mixedResult = materializeAnalysis({
      draft: mixed,
      documents: [{ name: "base.pdf", sourceUrl: null, index: mixedIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(mixedResult.claims.find((claim) => claim.claim_id === "invoice-portal")?.status)
      .toBe("needs_review");
    expect(mixedResult.summary.submission_method).toBeNull();

    const valid = addMinimumCoverage(draft([]));
    valid.summary.submission_method = "portal";
    valid.claims = [{
      claim_id: "submission-portal", topic: "submission method", claim_text: "portal",
      claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
      effect: "add", citations: [citation(baseSha, "Submission method: portal.")],
      supersedes_claim_ids: []
    }];
    const validIndex = index(baseSha, ["Submission method: portal.",
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
    const validResult = materializeAnalysis({
      draft: valid,
      documents: [{ name: "base.pdf", sourceUrl: null, index: validIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(validResult.claims.find((claim) => claim.claim_id === "submission-portal")?.status)
      .toBe("active");
    expect(validResult.summary.submission_method).toBe("portal");

    for (const [badQuote, badMethod] of [
      ["Submission method: bids must not be sent by email; courier delivery is required.", "email"],
      ["Submission method: anything but email.", "email"],
      ["Submission method: anything-but email.", "email"],
      ["Submission method: everything but email.", "email"],
      ["Submission method: a channel other than email.", "email"],
      ["Submission method: a channel other-than email.", "email"],
      ["Submission method: bids sent by email will be rejected; portal is required.", "email"],
      ["Submission method: email is unacceptable; portal is required.", "email"],
      ["Bids shall be sent via SFTP instead of email.", "email"],
      ["Bids shall be sent via SFTP as opposed to email.", "email"],
      ["Bids shall be sent via SFTP in lieu of email.", "email"],
      ["Bids shall be sent via SFTP, save email.", "email"],
      ["Submission method for invoicing: CanadaBuys portal.", "CanadaBuys portal"],
      ["Submission method for timesheets: CanadaBuys portal.", "CanadaBuys portal"]
    ] as const) {
      const bad = addMinimumCoverage(draft([]));
      bad.summary.submission_method = badMethod;
      bad.claims = [{
        claim_id: `bad-${badMethod}-${badQuote.length}`, topic: "submission method",
        claim_text: badMethod, claim_type: "source", confidence: 1,
        document_sha256: baseSha, amendment_number: null, effect: "add",
        citations: [citation(baseSha, badQuote)], supersedes_claim_ids: []
      }];
      const badIndex = index(baseSha, [badQuote,
        "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
      const badResult = materializeAnalysis({
        draft: bad,
        documents: [{ name: "base.pdf", sourceUrl: null, index: badIndex, role: "base", amendmentNumber: null }],
        manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
      }).result;
      expect(badResult.claims[0]?.status).toBe("needs_review");
      expect(badResult.summary.submission_method).toBeNull();
    }
  });

  it.each([
    "If an extension is approved, the solicitation closing date will be September 15, 2026.",
    "The solicitation closing date would be September 15, 2026 upon approval.",
    "Proposed solicitation closing date: September 15, 2026.",
    "Solicitation closing date is September 15, 2026 provided funding is approved.",
    "Solicitation closing date is September 15, 2026 conditional on funding.",
    "Assuming approval, solicitation closing date is September 15, 2026."
  ])("does not publish a non-definitive closing date: %s", (quote) => {
    const value = addMinimumCoverage(draft([]));
    value.summary.closing_date = "September 15, 2026";
    value.claims = [{
      claim_id: "conditional-closing", topic: "solicitation closing date",
      claim_text: "September 15, 2026", claim_type: "source", confidence: 1,
      document_sha256: baseSha, amendment_number: null, effect: "add",
      citations: [citation(baseSha, quote)], supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: index(baseSha, [quote,
        "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.claims.find((claim) => claim.claim_id === "conditional-closing")?.status)
      .toBe("needs_review");
    expect(result.summary.closing_date).toBeNull();
  });

  it.each([
    "If email is authorized, bids may be submitted by email.",
    "Bids may be submitted by email subject to approval.",
    "The proposed submission method is email.",
    "Bids shall be submitted by email provided funding is approved.",
    "Bids shall be submitted by email conditional on funding.",
    "Assuming approval, bids shall be submitted by email."
  ])("does not publish a non-definitive submission method: %s", (quote) => {
    const value = addMinimumCoverage(draft([]));
    value.summary.submission_method = "email";
    value.claims = [{
      claim_id: "conditional-submission", topic: "submission method", claim_text: "email",
      claim_type: "source", confidence: 1, document_sha256: baseSha,
      amendment_number: null, effect: "add", citations: [citation(baseSha, quote)],
      supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: index(baseSha, [quote,
        "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.claims.find((claim) => claim.claim_id === "conditional-submission")?.status)
      .toBe("needs_review");
    expect(result.summary.submission_method).toBeNull();
  });

  it.each([
    "The award may be based on the lowest price.",
    "A proposed award basis uses the lowest evaluated price.",
    "If funding is approved, the award will be based on the lowest price.",
    "Award will be made to the bid with the lowest price provided funding is approved.",
    "Award will be made to the bid with the lowest price conditional on funding.",
    "Assuming approval, award will be made to the bid with the lowest price."
  ])("does not publish a non-definitive selection method: %s", (quote) => {
    const method = quote.includes("evaluated") ? "lowest evaluated price" : "lowest price";
    const value = addMinimumCoverage(draft([]));
    value.summary.current_selection_method = method;
    value.evaluation.rules.push({
      id: "conditional-selection", field: "selection_method", topic: "selection method",
      document_sha256: baseSha, amendment_number: null, effect: "add", value: method,
      citations: [citation(baseSha, quote)]
    });
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: index(baseSha, [quote,
        "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.evaluation.selection_method).toBeNull();
    expect(result.summary.current_selection_method).toBeNull();
  });

  it.each([
    "Solicitation closing date is before September 15, 2026.",
    "Solicitation closing date differs from September 15, 2026.",
    "Insurance certificate submission deadline is September 15, 2026.",
    "Security clearance submission deadline is September 15, 2026.",
    "Invoice submission deadline is September 15, 2026."
  ])("does not publish a non-closing or non-equality date relation: %s", (quote) => {
    const value = addMinimumCoverage(draft([]));
    value.summary.closing_date = "September 15, 2026";
    value.claims = [{
      claim_id: "wrong-closing-object", topic: "solicitation closing date",
      claim_text: "September 15, 2026", claim_type: "source", confidence: 1,
      document_sha256: baseSha, amendment_number: null, effect: "add",
      citations: [citation(baseSha, quote)], supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: index(baseSha, [quote,
        "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.summary.closing_date).toBeNull();
    expect(result.claims.find((claim) => claim.claim_id === "wrong-closing-object")?.status)
      .toBe("needs_review");
  });

  it.each([
    "Award points are based on the lowest price.",
    "The award ranking uses proximity to the lowest price.",
    "Award is based on the difference from lowest price."
  ])("does not confuse a scoring comparison with the selection method: %s", (quote) => {
    const value = addMinimumCoverage(draft([]));
    value.summary.current_selection_method = "lowest price";
    value.evaluation.rules.push({
      id: "wrong-selection-object", field: "selection_method", topic: "selection method",
      document_sha256: baseSha, amendment_number: null, effect: "add", value: "lowest price",
      citations: [citation(baseSha, quote)]
    });
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: index(baseSha, [quote,
        "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.evaluation.selection_method).toBeNull();
    expect(result.summary.current_selection_method).toBeNull();
  });

  it.each([
    "Bid security must be submitted by email.",
    "The bid bond must be delivered by email.",
    "Bid samples shall be sent by email."
  ])("does not confuse a bid artifact channel with the whole submission method: %s", (quote) => {
    const value = addMinimumCoverage(draft([]));
    value.summary.submission_method = "email";
    value.claims = [{
      claim_id: "artifact-channel", topic: "submission method", claim_text: "email",
      claim_type: "source", confidence: 1, document_sha256: baseSha,
      amendment_number: null, effect: "add", citations: [citation(baseSha, quote)],
      supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: index(baseSha, [quote,
        "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.summary.submission_method).toBeNull();
    expect(result.claims.find((claim) => claim.claim_id === "artifact-channel")?.status)
      .toBe("needs_review");
  });

  it("binds title and issuer values to their own spans within a shared quote", () => {
    const sharedQuote = "RFP title: Real Contract. Issuer: Fake Corp.";
    const analyze = (title: string) => {
      const value = addMinimumCoverage(draft([]));
      value.summary.title = title;
      value.claims = [{
        claim_id: `title-${title}`, topic: "RFP title", claim_text: title,
        claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
        effect: "add", citations: [citation(baseSha, sharedQuote)], supersedes_claim_ids: []
      }];
      return materializeAnalysis({
        draft: value,
        documents: [{ name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }],
        manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
      }).result;
    };
    const fake = analyze("Fake Corp");
    expect(fake.claims.find((claim) => claim.claim_id === "title-Fake Corp")?.status).toBe("needs_review");
    expect(fake.summary.title).toBe("Document-only RFP analysis");
    const real = analyze("Real Contract");
    expect(real.claims.find((claim) => claim.claim_id === "title-Real Contract")?.status).toBe("active");
    expect(real.summary.title).toBe("Real Contract");

    const issuerDraft = addMinimumCoverage(draft([]));
    issuerDraft.summary.issuer = "Fake Corp";
    issuerDraft.claims = [{
      claim_id: "issuer-fake-corp", topic: "issuer", claim_text: "Fake Corp",
      claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
      effect: "add", citations: [citation(baseSha, sharedQuote)], supersedes_claim_ids: []
    }];
    const issuer = materializeAnalysis({
      draft: issuerDraft,
      documents: [{ name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(issuer.summary.issuer).toBe("Fake Corp");
  });

  it("withholds a closing timestamp with the wrong explicit UTC offset", () => {
    const value = addMinimumCoverage(draft([]));
    value.summary.closing_date = "2026-09-15 14:00 -05:00";
    value.claims = [{
      claim_id: "wrong-offset", topic: "closing date", claim_text: "2026-09-15 14:00 -05:00",
      claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
      effect: "add",
      citations: [citation(baseSha, "Closing date: September 15, 2026 at 14:00 -06:00.")],
      supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.claims.find((claim) => claim.claim_id === "wrong-offset")?.status).toBe("needs_review");
    expect(result.summary.closing_date).toBeNull();
  });

  it("binds a closing timezone to the closing span rather than a later question span", () => {
    const sharedQuote = "Closing date: September 15, 2026 at 14:00 MDT. " +
      "Questions are due September 15, 2026 at 14:00 EST.";
    const analyze = (timezone: "MDT" | "EST") => {
      const value = addMinimumCoverage(draft([]));
      value.summary.closing_date = `September 15, 2026 at 14:00 ${timezone}`;
      value.claims = [{
        claim_id: `closing-${timezone}`, topic: "solicitation closing date",
        claim_text: `September 15, 2026 at 14:00 ${timezone}`,
        claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
        effect: "add", citations: [citation(baseSha, sharedQuote)], supersedes_claim_ids: []
      }];
      return materializeAnalysis({
        draft: value,
        documents: [{ name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }],
        manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
      }).result;
    };
    const wrong = analyze("EST");
    expect(wrong.claims.find((claim) => claim.claim_id === "closing-EST")?.status).toBe("needs_review");
    expect(wrong.summary.closing_date).toBeNull();
    const correct = analyze("MDT");
    expect(correct.claims.find((claim) => claim.claim_id === "closing-MDT")?.status).toBe("active");
    expect(correct.summary.closing_date).toBe("September 15, 2026 at 14:00 MDT");
  });

  it("routes a mislabeled amendment to the server-derived question-deadline chain", () => {
    const deadlineBaseIndex = index(baseSha, [
      "Solicitation closing date: September 10, 2026 at 14:00 MDT.",
      "Questions must be received by September 3, 2026 at 14:00 MDT.",
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."
    ]);
    const deadlineAmendmentIndex = index(amendmentSha, [
      "The deadline for submitting questions is revised to September 5, 2026 at 14:00 MDT."
    ]);
    const value = addMinimumCoverage(draft([
      {
        id: "closing", topic: "solicitation closing date", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "submission",
        text: "Solicitation closing date: September 10, 2026 at 14:00 MDT.",
        evidence_needed: null, consequence: null,
        citations: [citation(baseSha, "Solicitation closing date: September 10, 2026 at 14:00 MDT.")]
      },
      {
        id: "questions-old", topic: "question deadline", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "submission",
        text: "Questions must be received by September 3, 2026 at 14:00 MDT.",
        evidence_needed: null, consequence: null,
        citations: [citation(baseSha, "Questions must be received by September 3, 2026 at 14:00 MDT.")]
      },
      {
        id: "questions-new", topic: "solicitation closing date", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "submission",
        text: "The deadline for submitting questions is revised to September 5, 2026 at 14:00 MDT.",
        evidence_needed: null, consequence: null,
        citations: [citation(amendmentSha,
          "The deadline for submitting questions is revised to September 5, 2026 at 14:00 MDT.")]
      }
    ]));
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: deadlineBaseIndex, role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: deadlineAmendmentIndex, role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "closing")?.status).toBe("active");
    expect(result.requirements.find((item) => item.id === "questions-old")?.status).toBe("superseded");
    expect(result.requirements.find((item) => item.id === "questions-new")?.status).toBe("active");
    expect(result.conflicts).toEqual([]);
  });

  it("withholds an amendment whose generic deadline wording does not identify the field", () => {
    const deadlineBaseIndex = index(baseSha, [
      "Solicitation closing date: September 10, 2026 at 14:00 MDT.",
      "Questions must be received by September 3, 2026 at 14:00 MDT.",
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."
    ]);
    const ambiguousAmendmentIndex = index(amendmentSha, [
      "Amendment 001 updates the deadline to September 15, 2026 at 14:00 MDT."
    ]);
    const value = addMinimumCoverage(draft([
      {
        id: "closing-old", topic: "solicitation closing date", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "submission",
        text: "Solicitation closing date: September 10, 2026 at 14:00 MDT.",
        evidence_needed: null, consequence: null,
        citations: [citation(baseSha, "Solicitation closing date: September 10, 2026 at 14:00 MDT.")]
      },
      {
        id: "deadline-ambiguous", topic: "solicitation closing date", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "submission",
        text: "Amendment 001 updates the deadline to September 15, 2026 at 14:00 MDT.",
        evidence_needed: null, consequence: null,
        citations: [citation(amendmentSha,
          "Amendment 001 updates the deadline to September 15, 2026 at 14:00 MDT.")]
      }
    ]));
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: deadlineBaseIndex, role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: ambiguousAmendmentIndex, role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "closing-old")?.status).toBe("active");
    expect(result.requirements.find((item) => item.id === "deadline-ambiguous")?.status).toBe("needs_review");
    expect(result.conflicts).toEqual([]);
  });

  it("does not let an Amendment label authorize replacement of an unrelated object", () => {
    const insuranceBaseIndex = index(baseSha, [
      "Insurance coverage of 5000000 CAD is required.",
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."
    ]);
    const meetingsAmendmentIndex = index(amendmentSha, [
      "Amendment 001. Project meetings will be held weekly."
    ]);
    const value = addMinimumCoverage(draft([
      {
        id: "insurance", topic: "insurance coverage", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "contractual",
        text: "Insurance coverage of 5000000 CAD is required.", evidence_needed: null,
        consequence: null, citations: [citation(baseSha, "Insurance coverage of 5000000 CAD is required.")]
      },
      {
        id: "meetings", topic: "insurance coverage", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "contractual",
        text: "Project meetings will be held weekly.", evidence_needed: null,
        consequence: null,
        citations: [citation(amendmentSha, "Amendment 001. Project meetings will be held weekly.")]
      }
    ]));
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: insuranceBaseIndex, role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: meetingsAmendmentIndex, role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "insurance")?.status).toBe("active");
    expect(result.requirements.find((item) => item.id === "meetings")?.status).toBe("needs_review");
  });

  it("does not borrow an unchanged adjacent object into a mutation scope", () => {
    const insuranceBaseIndex = index(baseSha, [
      "Insurance coverage of 5000000 CAD is required.",
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."
    ]);
    const mixedAmendmentIndex = index(amendmentSha, [
      "Amendment updates the project schedule, while insurance coverage is not changed."
    ]);
    const value = addMinimumCoverage(draft([
      {
        id: "insurance-current", topic: "insurance coverage", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "contractual",
        text: "Insurance coverage of 5000000 CAD is required.", evidence_needed: null,
        consequence: null, citations: [citation(baseSha, "Insurance coverage of 5000000 CAD is required.")]
      },
      {
        id: "fake-schedule", topic: "insurance coverage", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "contractual",
        text: "Project schedule", evidence_needed: null, consequence: null,
        citations: [citation(amendmentSha,
          "Amendment updates the project schedule, while insurance coverage is not changed.")]
      }
    ]));
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: insuranceBaseIndex, role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: mixedAmendmentIndex, role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "insurance-current")?.status).toBe("active");
    expect(result.requirements.find((item) => item.id === "fake-schedule")?.status).toBe("needs_review");
  });

  it("derives insurance object identity instead of trusting a shared model topic", () => {
    const wideCoverageQuote = "Insurance coverage of 5000000 CAD is required. " +
      "Insurance contact is Bob.";
    const insuranceBaseIndex = index(baseSha, [
      wideCoverageQuote,
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."
    ]);
    const contactAmendmentIndex = index(amendmentSha, [
      "Insurance coverage contact information changed to Alice."
    ]);
    const value = addMinimumCoverage(draft([
      {
        id: "coverage", topic: "insurance coverage", document_sha256: baseSha, amendment_number: null,
        effect: "add", category: "contractual", text: "Insurance coverage of 5000000 CAD is required.",
        evidence_needed: null, consequence: null,
        citations: [citation(baseSha, wideCoverageQuote)]
      },
      {
        id: "contact", topic: "insurance coverage", document_sha256: amendmentSha, amendment_number: "001",
        effect: "replace", category: "contractual",
        text: "Insurance coverage contact information changed to Alice.",
        evidence_needed: null, consequence: null,
        citations: [citation(amendmentSha, "Insurance coverage contact information changed to Alice.")]
      }
    ]));
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: insuranceBaseIndex, role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: contactAmendmentIndex, role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "coverage")?.status).toBe("active");
    expect(result.requirements.find((item) => item.id === "contact")?.status).toBe("needs_review");
  });

  it("separates bare-and insurance fields while accepting a value-bound coverage increase", () => {
    const baseQuote = "Insurance coverage limit is 5000000 CAD and insurance contact is Bob.";
    const contactQuote = "Insurance contact is changed to Alice.";
    const coverageQuote =
      "Insurance coverage limit is increased to 10000000 CAD and insurance contact remains Bob.";
    const value = addMinimumCoverage(draft([
      {
        id: "coverage-base", topic: "insurance coverage", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "contractual",
        text: "Insurance coverage limit is 5000000 CAD", evidence_needed: null,
        consequence: null, citations: [citation(baseSha, baseQuote)]
      },
      {
        id: "contact-only", topic: "insurance coverage", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "contractual",
        text: contactQuote, evidence_needed: null, consequence: null,
        citations: [citation(amendmentSha, contactQuote)]
      },
      {
        id: "coverage-increase", topic: "insurance coverage", document_sha256: "c".repeat(64),
        amendment_number: "002", effect: "replace", category: "contractual",
        text: "Insurance coverage limit is increased to 10000000 CAD", evidence_needed: null,
        consequence: null, citations: [citation("c".repeat(64), coverageQuote)]
      }
    ]));
    const secondSha = "c".repeat(64);
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: index(baseSha, [baseQuote,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: index(amendmentSha, [contactQuote]), role: "amendment", amendmentNumber: "001" },
        { name: "a002.pdf", sourceUrl: null, index: index(secondSha, [coverageQuote]), role: "amendment", amendmentNumber: "002" }
      ],
      manifests: [
        manifests[0],
        { ...manifests[1], amendment_number: "001", pages: 1 },
        { ...manifests[1], document_id: crypto.randomUUID(), sha256: secondSha,
          amendment_number: "002", pages: 1 }
      ],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "contact-only")?.status)
      .toBe("needs_review");
    expect(result.requirements.find((item) => item.id === "coverage-base")?.status)
      .toBe("superseded");
    expect(result.requirements.find((item) => item.id === "coverage-increase")?.status)
      .toBe("active");
  });

  it("fails closed for destructive objects outside the server-owned taxonomy", () => {
    const clearance = "Security clearance at Reliability Status is required.";
    const contact = "Security clearance contact information changed to Alice.";
    const value = addMinimumCoverage(draft([
      {
        id: "clearance", topic: "security clearance", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "security", text: clearance,
        evidence_needed: null, consequence: null, citations: [citation(baseSha, clearance)]
      },
      {
        id: "clearance-contact", topic: "security clearance", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "security", text: contact,
        evidence_needed: null, consequence: null, citations: [citation(amendmentSha, contact)]
      }
    ]));
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: index(baseSha, [clearance,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: index(amendmentSha, [contact]), role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "clearance")?.status).toBe("active");
    expect(result.requirements.find((item) => item.id === "clearance-contact")?.status)
      .toBe("needs_review");
  });

  it.each([
    "Insurance coverage isn't changed.",
    "Insurance coverage wasn't changed.",
    "Insurance coverage is by no means changed.",
    "Insurance coverage cannot be changed to 10000000 CAD.",
    "Insurance coverage changes to 10000000 CAD do not apply.",
    "Insurance coverage changes to 10000000 CAD are excluded.",
    "Insurance coverage changes to 10000000 CAD will not take effect.",
    "Insurance coverage may be changed to 10000000 CAD.",
    "Insurance coverage would have changed to 10000000 CAD.",
    "Insurance coverage is expected to change to 10000000 CAD.",
    "It is possible that insurance coverage will change to 10000000 CAD.",
    "Upon approval, insurance coverage changes to 10000000 CAD.",
    "Insurance coverage is changed to 10000000 CAD when approved.",
    "Once the option is exercised, insurance coverage is changed to 10000000 CAD.",
    "Insurance coverage is changed to 10000000 CAD subject to funding.",
    "Insurance coverage is changed to 10000000 CAD only after funding is approved.",
    "Pending review, insurance coverage is changed to 10000000 CAD.",
    "Draft amendment: insurance coverage is changed to 10000000 CAD.",
    "For discussion only, insurance coverage is changed to 10000000 CAD.",
    "The change to insurance coverage is 10000000 CAD for reference.",
    "Revised estimate for insurance coverage is 10000000 CAD.",
    "Question: Can insurance coverage change to 10000000 CAD?",
    "Option: insurance coverage changes to 10000000 CAD.",
    "The bidder expects insurance coverage to change to 10000000 CAD.",
    "A proposal to change insurance coverage to 10000000 CAD was rejected.",
    "Insurance coverage was proposed to be changed to 10000000 CAD.",
    "Insurance coverage is changed to 10000000 CAD, but this change was later withdrawn.",
    "If approved, insurance coverage is changed to 10000000 CAD."
  ])("does not treat negated mutation language as a replacement: %s", (amendmentText) => {
    const current = "Insurance coverage of 5000000 CAD is required.";
    const value = addMinimumCoverage(draft([
      {
        id: "coverage-current", topic: "insurance coverage", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "contractual", text: current,
        evidence_needed: null, consequence: null, citations: [citation(baseSha, current)]
      },
      {
        id: "coverage-negated", topic: "insurance coverage", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "contractual", text: amendmentText,
        evidence_needed: null, consequence: null, citations: [citation(amendmentSha, amendmentText)]
      }
    ]));
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: index(baseSha, [current,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: index(amendmentSha, [amendmentText]), role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "coverage-current")?.status).toBe("active");
    expect(result.requirements.find((item) => item.id === "coverage-negated")?.status)
      .toBe("needs_review");
  });

  it("binds destructive mutations to the new-value role, including formatted amounts", () => {
    const reconcileCoverage = (value: string, quote: string) => reconcileVersionedFacts([
      {
        id: "coverage-old", topic: "insurance coverage", value: "Insurance coverage is 5000000 CAD.",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, "Insurance coverage is 5000000 CAD.")]
      },
      {
        id: "coverage-next", topic: "insurance coverage", value,
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "replace", citations: [verifiedCitation(amendmentSha, quote)]
      }
    ]);
    const wrongFromValue = reconcileCoverage(
      "Insurance coverage is 5000000 CAD.",
      "Insurance coverage is changed from 5000000 CAD to 10000000 CAD."
    );
    expect(wrongFromValue.unauthorizedMutationIds).toContain("coverage-next");
    const rightFromValue = reconcileCoverage(
      "Insurance coverage is 10000000 CAD.",
      "Insurance coverage is changed from 5000000 CAD to 10000000 CAD."
    );
    expect(rightFromValue.unauthorizedMutationIds).not.toContain("coverage-next");
    const formattedAmount = reconcileCoverage(
      "Insurance coverage is 5,000,000 CAD.",
      "Insurance coverage is changed to 5,000,000 CAD."
    );
    expect(formattedAmount.unauthorizedMutationIds).not.toContain("coverage-next");
    const contrastOldValue = reconcileCoverage(
      "Insurance coverage is 5000000 CAD.",
      "Insurance coverage is changed to 10000000 CAD, not 5000000 CAD."
    );
    expect(contrastOldValue.unauthorizedMutationIds).toContain("coverage-next");
    expect(reconcileCoverage(
      "Insurance coverage is 5000000 CAD.",
      "This amendment changes insurance coverage to 10000000 CAD from 5000000 CAD."
    ).unauthorizedMutationIds).toContain("coverage-next");
    expect(reconcileCoverage(
      "Insurance coverage is 10000000 CAD.",
      "This amendment changes insurance coverage to 10000000 CAD from 5000000 CAD."
    ).unauthorizedMutationIds).not.toContain("coverage-next");
    expect(reconcileCoverage(
      "Insurance coverage is 5000000 CAD.",
      "This amendment replaces insurance coverage of 5000000 CAD by 10000000 CAD."
    ).unauthorizedMutationIds).toContain("coverage-next");
    expect(reconcileCoverage(
      "Insurance coverage is 10000000 CAD.",
      "This amendment replaces insurance coverage of 5000000 CAD by 10000000 CAD."
    ).unauthorizedMutationIds).not.toContain("coverage-next");
    expect(reconcileCoverage(
      "Insurance coverage is 5000000 CAD.",
      "Insurance coverage is increased by 5000000 CAD."
    ).unauthorizedMutationIds).toContain("coverage-next");
    expect(reconcileCoverage(
      "Insurance coverage is 10000000 CAD.",
      "Insurance coverage is changed to 10000000 USD (equivalent reference: 10000000 CAD)."
    ).unauthorizedMutationIds).toContain("coverage-next");
    expect(reconcileCoverage(
      "Insurance coverage is 10000000 CAD.",
      "This amendment changes insurance coverage to 10000000 USD (13000000 CAD)."
    ).unauthorizedMutationIds).toContain("coverage-next");
    expect(reconcileCoverage(
      "Insurance coverage is 13000000 CAD.",
      "This amendment changes insurance coverage to 10000000 USD (13000000 CAD)."
    ).unauthorizedMutationIds).toContain("coverage-next");
    expect(reconcileCoverage(
      "Insurance coverage is 5000000 CAD.",
      "This amendment changes insurance coverage to 10000000 CAD plus a 5000000 CAD aggregate."
    ).unauthorizedMutationIds).toContain("coverage-next");
  });

  it("accepts only the terminal value in a sequence of effective mutations", () => {
    const reconcileCoverage = (value: string, quote: string) => reconcileVersionedFacts([
      {
        id: "coverage-old", topic: "insurance coverage", value: "Insurance coverage is 5000000 CAD.",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, "Insurance coverage is 5000000 CAD.")]
      },
      {
        id: "coverage-next", topic: "insurance coverage", value,
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "replace", citations: [verifiedCitation(amendmentSha, quote)]
      }
    ]);
    const twoStep = "Insurance coverage was changed to 10000000 CAD and later revised to 15000000 CAD.";
    expect(reconcileCoverage("Insurance coverage is 10000000 CAD.", twoStep).unauthorizedMutationIds)
      .toContain("coverage-next");
    expect(reconcileCoverage("Insurance coverage is 15000000 CAD.", twoStep).unauthorizedMutationIds)
      .not.toContain("coverage-next");
    const restored = "Insurance coverage was changed to 10000000 CAD and later restored to 5000000 CAD.";
    expect(reconcileCoverage("Insurance coverage is 10000000 CAD.", restored).unauthorizedMutationIds)
      .toContain("coverage-next");
    const crossClause = "Insurance coverage was changed to 10000000 CAD; the revised limit is 15000000 CAD.";
    expect(reconcileCoverage("Insurance coverage is 10000000 CAD.", crossClause).unauthorizedMutationIds)
      .toContain("coverage-next");
  });

  it("binds changed-from deadline mutations only to the target date", () => {
    const reconcileDeadline = (value: string) => reconcileVersionedFacts([
      {
        id: "deadline-old", topic: "solicitation closing date", value: "September 1, 2026",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, "Solicitation closing date is September 1, 2026.")]
      },
      {
        id: "deadline-next", topic: "solicitation closing date", value,
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "replace", citations: [verifiedCitation(amendmentSha,
          "Solicitation closing date is changed from September 1, 2026 to September 15, 2026.")]
      }
    ]);
    expect(reconcileDeadline("September 1, 2026").unauthorizedMutationIds)
      .toContain("deadline-next");
    expect(reconcileDeadline("September 15, 2026").unauthorizedMutationIds)
      .not.toContain("deadline-next");
  });

  it("does not let a model topic bridge solicitation and question deadline identities", () => {
    const result = reconcileVersionedFacts([
      {
        id: "closing-old", topic: "solicitation closing date", value: "September 10, 2026",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha,
          "Solicitation closing date is September 10, 2026.")]
      },
      {
        id: "questions-old", topic: "question deadline", value: "August 20, 2026",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, "Questions are due August 20, 2026.")]
      },
      {
        id: "questions-new", topic: "solicitation closing date", value: "August 25, 2026",
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "replace", citations: [verifiedCitation(amendmentSha,
          "The questions deadline is changed to August 25, 2026.")]
      }
    ]);
    expect(result.facts.find((fact) => fact.id === "closing-old")?.status).toBe("active");
    expect(result.facts.find((fact) => fact.id === "questions-old")?.status).toBe("superseded");
    expect(result.facts.find((fact) => fact.id === "questions-new")?.status).toBe("active");
  });

  it("requires the complete authoritative deadline tuple", () => {
    const quote = "Solicitation closing date is changed to September 15, 2026 at 16:00 MDT.";
    const reconcileDeadline = (value: string) => reconcileVersionedFacts([
      {
        id: "deadline-old", topic: "solicitation closing date",
        value: "September 1, 2026 at 14:00 MDT", documentSha256: baseSha,
        documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha,
          "Solicitation closing date is September 1, 2026 at 14:00 MDT.")]
      },
      {
        id: "deadline-next", topic: "solicitation closing date", value,
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "replace", citations: [verifiedCitation(amendmentSha, quote)]
      }
    ]);
    expect(reconcileDeadline("September 15, 2026").unauthorizedMutationIds)
      .toContain("deadline-next");
    expect(reconcileDeadline("September 15, 2026 at 16:00").unauthorizedMutationIds)
      .toContain("deadline-next");
    expect(reconcileDeadline("September 15, 2026 at 16:00 MDT").unauthorizedMutationIds)
      .not.toContain("deadline-next");
  });

  it("does not let a delete-only sibling authorize an unrelated replacement value", () => {
    const result = reconcileVersionedFacts([
      {
        id: "coverage-old", topic: "insurance coverage", factKey: "insurance:coverage",
        factKeySource: "validated", value: "Insurance coverage is 5000000 CAD.",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, "Insurance coverage is 5000000 CAD.")]
      },
      {
        id: "coverage-delete", topic: "insurance coverage", factKey: "insurance:coverage",
        factKeySource: "validated", value: "Delete insurance coverage.",
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "delete", citations: [verifiedCitation(amendmentSha, "Delete insurance coverage.")]
      },
      {
        id: "coverage-considered", topic: "insurance coverage", factKey: "insurance:coverage",
        factKeySource: "validated", value: "Insurance coverage of 50000000 CAD was considered.",
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "replace", citations: [verifiedCitation(amendmentSha,
          "Insurance coverage of 50000000 CAD was considered.")]
      }
    ]);
    expect(result.unauthorizedMutationIds).toContain("coverage-considered");
  });

  it.each([
    "Draft amendment: insurance coverage no longer applies.",
    "A proposal states insurance coverage no longer applies.",
    "The proposal provides that insurance coverage no longer applies.",
    "According to a draft, insurance coverage no longer applies.",
    "Insurance coverage no longer applies when the option is exercised.",
    "Insurance coverage no longer applies only if the option is exercised.",
    "Insurance coverage no longer applies, but was later reinstated.",
    "Upon approval, insurance coverage no longer applies."
  ])("does not authorize a conditional or draft deletion: %s", (quote) => {
    const result = reconcileVersionedFacts([
      {
        id: "coverage-old", topic: "insurance coverage", value: "Insurance coverage is 5000000 CAD.",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, "Insurance coverage is 5000000 CAD.")]
      },
      {
        id: "coverage-delete", topic: "insurance coverage", value: "Insurance coverage no longer applies.",
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "delete", citations: [verifiedCitation(amendmentSha, quote)]
      }
    ]);
    expect(result.unauthorizedMutationIds).toContain("coverage-delete");
    expect(result.facts.find((fact) => fact.id === "coverage-old")?.status).toBe("active");
  });

  it.each([
    "Insurance coverage is changed to 10000000 CAD provided funding is approved.",
    "Insurance coverage is changed to 10000000 CAD conditional on funding.",
    "Insurance coverage is changed to 10000000 CAD effective after approval.",
    "Assuming funding approval, insurance coverage is changed to 10000000 CAD.",
    "Insurance coverage is changed to 10000000 CAD on condition that funding is approved.",
    "Insurance coverage is changed to 10000000 CAD following exercise of the option.",
    "Insurance coverage is changed to 10000000 CAD subject only to funding approval."
  ])("does not authorize a contingent replacement: %s", (quote) => {
    const result = reconcileVersionedFacts([
      {
        id: "coverage-old", topic: "insurance coverage", value: "Insurance coverage is 5000000 CAD.",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, "Insurance coverage is 5000000 CAD.")]
      },
      {
        id: "coverage-next", topic: "insurance coverage", value: "Insurance coverage is 10000000 CAD.",
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "replace", citations: [verifiedCitation(amendmentSha, quote)]
      }
    ]);
    expect(result.unauthorizedMutationIds).toContain("coverage-next");
    expect(result.facts.find((fact) => fact.id === "coverage-old")?.status).toBe("active");
  });

  it("does not borrow an adjacent solicitation label to scope an ambiguous deadline mutation", () => {
    const deadlineBaseIndex = index(baseSha, [
      "Solicitation closing date: September 10, 2026.",
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."
    ]);
    const ambiguousAmendmentIndex = index(amendmentSha, [
      "Amendment updates the deadline to September 5, 2026. Solicitation number: CER-1."
    ]);
    const value = addMinimumCoverage(draft([
      {
        id: "closing", topic: "solicitation closing date", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "submission",
        text: "Solicitation closing date: September 10, 2026.", evidence_needed: null,
        consequence: null,
        citations: [citation(baseSha, "Solicitation closing date: September 10, 2026.")]
      },
      {
        id: "fake-scope", topic: "schedule update", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "submission",
        text: "Solicitation deadline updates to September 5, 2026.", evidence_needed: null,
        consequence: null,
        citations: [citation(amendmentSha,
          "Amendment updates the deadline to September 5, 2026. Solicitation number: CER-1.")]
      }
    ]));
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: deadlineBaseIndex, role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: ambiguousAmendmentIndex, role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "closing")?.status).toBe("active");
    expect(result.requirements.find((item) => item.id === "fake-scope")?.status).toBe("needs_review");
  });

  it.each([
    {
      name: "solicitation number",
      baseText: "Solicitation closing date: September 10, 2026.",
      topic: "schedule update",
      claimText: "Solicitation deadline updates to September 5, 2026.",
      amendmentText: "Amendment updates the deadline to September 5, 2026, solicitation number CER-1."
    },
    {
      name: "questions reference",
      baseText: "Questions must be received by September 3, 2026.",
      topic: "schedule update",
      claimText: "Questions deadline updates to September 5, 2026.",
      amendmentText: "Amendment updates the deadline to September 5, 2026, questions reference Section 2."
    },
    {
      name: "different solicitation closing relation",
      baseText: "Solicitation closing date: September 10, 2026.",
      topic: "schedule update",
      claimText: "Solicitation deadline updates to September 5, 2026.",
      amendmentText: "Amendment updates the deadline to September 5, 2026, while the solicitation closes September 10, 2026."
    },
    {
      name: "different question deadline relation",
      baseText: "Questions must be received by September 3, 2026.",
      topic: "schedule update",
      claimText: "Questions deadline updates to September 5, 2026.",
      amendmentText: "Amendment updates the deadline to September 5, 2026, while questions are due September 3, 2026."
    },
    {
      name: "and-prefixed question deadline relation",
      baseText: "Questions must be received by September 3, 2026.",
      topic: "schedule update",
      claimText: "Questions deadline updates to September 5, 2026.",
      amendmentText: "Amendment updates the deadline to September 5, 2026, and questions are due September 3, 2026."
    },
    {
      name: "em-dash question deadline relation",
      baseText: "Questions must be received by September 3, 2026.",
      topic: "schedule update",
      claimText: "Questions deadline updates to September 5, 2026.",
      amendmentText: "Amendment updates the deadline to September 5, 2026 — questions are due September 3, 2026."
    },
    {
      name: "parenthesized question deadline relation",
      baseText: "Questions must be received by September 3, 2026.",
      topic: "schedule update",
      claimText: "Questions deadline updates to September 5, 2026.",
      amendmentText: "Amendment updates the deadline to September 5, 2026 (questions are due September 3, 2026)."
    },
    {
      name: "colon question deadline relation",
      baseText: "Questions must be received by September 3, 2026.",
      topic: "schedule update",
      claimText: "Questions deadline updates to September 5, 2026.",
      amendmentText: "Amendment updates the deadline to September 5, 2026: questions are due September 3, 2026."
    },
    {
      name: "with-prefixed question deadline relation",
      baseText: "Questions must be received by September 3, 2026.",
      topic: "schedule update",
      claimText: "Questions deadline updates to September 5, 2026.",
      amendmentText: "Amendment updates the deadline to September 5, 2026, with questions due September 3, 2026."
    },
    {
      name: "bare-and written question deadline relation",
      baseText: "Questions must be received by September 3, 2026.",
      topic: "schedule update",
      claimText: "Questions deadline updates to September 5, 2026.",
      amendmentText: "Amendment updates the deadline to September 5, 2026 and written questions are due September 3, 2026."
    },
    {
      name: "same-scalar solicitation relation",
      baseText: "Questions must be received by September 3, 2026.",
      topic: "question deadline",
      claimText: "Questions deadline updates to September 5, 2026.",
      amendmentText: "The solicitation closes September 5, 2026, and questions are due September 3, 2026."
    }
  ])("does not borrow a comma-adjacent $name label to scope a generic deadline", ({
    baseText, topic, claimText, amendmentText
  }) => {
    const scopedBaseIndex = index(baseSha, [baseText,
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
    const scopedAmendmentIndex = index(amendmentSha, [amendmentText]);
    const value = addMinimumCoverage(draft([
      {
        id: "deadline-current", topic: baseText.startsWith("Questions") ? "question deadline" : "closing date",
        document_sha256: baseSha, amendment_number: null, effect: "add", category: "submission",
        text: baseText, evidence_needed: null, consequence: null,
        citations: [citation(baseSha, baseText)]
      },
      {
        id: "deadline-fake", topic, document_sha256: amendmentSha, amendment_number: "001",
        effect: "replace", category: "submission", text: claimText, evidence_needed: null,
        consequence: null, citations: [citation(amendmentSha, amendmentText)]
      }
    ]));
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: scopedBaseIndex, role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: scopedAmendmentIndex, role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "deadline-current")?.status).toBe("active");
    expect(result.requirements.find((item) => item.id === "deadline-fake")?.status).toBe("needs_review");
  });

  it("separates a comma-delimited question timezone from the closing tuple", () => {
    const quote = "Closing date: September 15, 2026 at 14:00 MDT, " +
      "questions close at September 15, 2026 at 14:00 EST.";
    const commaIndex = index(baseSha, [quote,
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
    const value = addMinimumCoverage(draft([]));
    value.summary.closing_date = "September 15, 2026 at 14:00 EST";
    value.claims = [{
      claim_id: "comma-closing", topic: "closing date",
      claim_text: "September 15, 2026 at 14:00 EST", claim_type: "source", confidence: 1,
      document_sha256: baseSha, amendment_number: null, effect: "add",
      citations: [citation(baseSha, quote)], supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: commaIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.claims.find((item) => item.claim_id === "comma-closing")?.status).toBe("needs_review");
    expect(result.summary.closing_date).toBeNull();
  });

  it("separates a Q&A cutoff field timezone from the closing tuple", () => {
    const quote = "Closing date: September 15, 2026 at 14:00, " +
      "Q and A cutoff is September 15, 2026 at 14:00 EST.";
    const commaIndex = index(baseSha, [quote,
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
    const value = addMinimumCoverage(draft([]));
    value.summary.closing_date = "September 15, 2026 at 14:00 EST";
    value.claims = [{
      claim_id: "qa-cutoff-closing", topic: "closing date",
      claim_text: "September 15, 2026 at 14:00 EST", claim_type: "source", confidence: 1,
      document_sha256: baseSha, amendment_number: null, effect: "add",
      citations: [citation(baseSha, quote)], supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: commaIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.claims.find((item) => item.claim_id === "qa-cutoff-closing")?.status).toBe("needs_review");
    expect(result.summary.closing_date).toBeNull();
  });

  it("binds each evaluation weight to its own label instead of accepting swapped 30/70 values", () => {
    const weightQuote = "The ratio is 70% for technical merit and 30% for price.";
    const analyze = (technical: string, financial: string) => {
      const value = addMinimumCoverage(draft([]));
      value.evaluation.rules.push(
        {
          id: `technical-${technical}`, field: "technical_weight", topic: "technical weight",
          document_sha256: baseSha, amendment_number: null, effect: "add", value: technical,
          citations: [citation(baseSha, weightQuote)]
        },
        {
          id: `financial-${financial}`, field: "financial_weight", topic: "financial weight",
          document_sha256: baseSha, amendment_number: null, effect: "add", value: financial,
          citations: [citation(baseSha, weightQuote)]
        }
      );
      return materializeAnalysis({
        draft: value,
        documents: [{ name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }],
        manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
      }).result;
    };
    const swapped = analyze("30", "70");
    expect(swapped.evaluation.technical_weight).toBeNull();
    expect(swapped.evaluation.financial_weight).toBeNull();
    expect(swapped.quality.unsupported_items_removed).toBeGreaterThanOrEqual(2);
    const canonical = analyze("70", "30");
    expect(canonical.evaluation.technical_weight).toBe(70);
    expect(canonical.evaluation.financial_weight).toBe(30);
  });

  it("binds the selection method to the award predicate rather than nearby reference words", () => {
    const quote = "Award uses the highest combined rating. Lowest price is listed for reference.";
    const selectionIndex = index(baseSha, [quote,
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
    const value = addMinimumCoverage(draft([]));
    value.summary.current_selection_method = "lowest rating";
    value.evaluation.rules.push({
      id: "false-selection", field: "selection_method", topic: "selection method",
      document_sha256: baseSha, amendment_number: null, effect: "add", value: "lowest rating",
      citations: [citation(baseSha, quote)]
    });
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: selectionIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.evaluation.selection_method).toBeNull();
    expect(result.summary.current_selection_method).toBeNull();

    const calculationQuote = "Award uses the highest combined rating; " +
      "the lowest price is used only to calculate financial points.";
    const calculationIndex = index(baseSha, [calculationQuote,
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
    const calculation = addMinimumCoverage(draft([]));
    calculation.summary.current_selection_method = "lowest price";
    calculation.evaluation.rules.push({
      id: "price-calculation", field: "selection_method", topic: "selection method",
      document_sha256: baseSha, amendment_number: null, effect: "add", value: "lowest price",
      citations: [citation(baseSha, calculationQuote)]
    });
    const calculationResult = materializeAnalysis({
      draft: calculation,
      documents: [{
        name: "base.pdf", sourceUrl: null, index: calculationIndex, role: "base", amendmentNumber: null
      }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(calculationResult.evaluation.selection_method).toBeNull();
    expect(calculationResult.summary.current_selection_method).toBeNull();

    for (const negatedQuote of [
      "Award is not based on lowest price; selection uses the highest combined rating.",
      "Award isn't based on lowest price; selection uses the highest combined rating.",
      "Award is based on factors other than lowest price; selection uses the highest combined rating.",
      "Award is based on a criterion other-than lowest price; selection uses the highest combined rating.",
      "Award is made exclusive of lowest price; selection uses the highest combined rating.",
      "Award disregards lowest price; selection uses the highest combined rating.",
      "Award is made regardless of lowest price; selection uses the highest combined rating.",
      "Award is based on technical merit instead of the lowest price; selection uses the highest combined rating.",
      "Award is based on technical merit as opposed to the lowest price; selection uses the highest combined rating.",
      "Award is based on technical merit apart from the lowest price; selection uses the highest combined rating.",
      "Award is based on technical merit in lieu of the lowest price; selection uses the highest combined rating.",
      "Award is made without regard to lowest price; selection uses the highest combined rating.",
      "Award is made irrespective of lowest price; selection uses the highest combined rating."
    ]) {
      const negatedIndex = index(baseSha, [negatedQuote,
        "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
      const negated = addMinimumCoverage(draft([]));
      negated.summary.current_selection_method = "lowest price";
      negated.evaluation.rules.push({
        id: `negated-price-${negatedQuote.length}`, field: "selection_method", topic: "selection method",
        document_sha256: baseSha, amendment_number: null, effect: "add", value: "lowest price",
        citations: [citation(baseSha, negatedQuote)]
      });
      const negatedResult = materializeAnalysis({
        draft: negated,
        documents: [{ name: "base.pdf", sourceUrl: null, index: negatedIndex, role: "base", amendmentNumber: null }],
        manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
      }).result;
      expect(negatedResult.evaluation.selection_method).toBeNull();
      expect(negatedResult.summary.current_selection_method).toBeNull();
    }

    const validQuote = "Canada will make its selection based on the compliant offer with the " +
      "highest combined rating of technical merit and price for award.";
    const validIndex = index(baseSha, [validQuote,
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
    const valid = addMinimumCoverage(draft([]));
    valid.summary.current_selection_method = "highest combined rating of technical merit and price";
    valid.evaluation.rules.push({
      id: "valid-selection", field: "selection_method", topic: "selection method",
      document_sha256: baseSha, amendment_number: null, effect: "add",
      value: "highest combined rating of technical merit and price",
      citations: [citation(baseSha, validQuote)]
    });
    const validResult = materializeAnalysis({
      draft: valid,
      documents: [{ name: "base.pdf", sourceUrl: null, index: validIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(validResult.evaluation.selection_method)
      .toBe("highest combined rating of technical merit and price");
    expect(validResult.summary.current_selection_method)
      .toBe("highest combined rating of technical merit and price");
  });

  it("binds a rated threshold to the minimum numerator and preserves its 50/94 scale", () => {
    const thresholdQuote =
      "Bidders must obtain a minimum score of fifty (50) points on a scale of ninety-four (94) points.";
    const analyze = (threshold: string) => {
      const value = addMinimumCoverage(draft([]));
      value.evaluation.rules.push({
        id: `threshold-${threshold}`, field: "rated_threshold", topic: "rated threshold",
        document_sha256: baseSha, amendment_number: null, effect: "add", value: threshold,
        citations: [citation(baseSha, thresholdQuote)]
      });
      return materializeAnalysis({
        draft: value,
        documents: [{ name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }],
        manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
      }).result;
    };
    expect(analyze("94").evaluation.rated_threshold).toBeNull();
    expect(analyze("50/94").evaluation.rated_threshold).toBe("50/94");
  });

  it("validates every evaluation field independently and reconciles by server document order", () => {
    const value = draft([]);
    addMinimumCoverage(value);
    value.evaluation.rules.push(
      {
        id: "invented-technical", field: "technical_weight", topic: "technical weight",
        document_sha256: baseSha, amendment_number: null, effect: "add", value: "99",
        citations: [citation(baseSha, "A bid that fails a mandatory requirement will be non-compliant.")]
      },
      {
        id: "technical-base", field: "technical_weight", topic: "technical weight",
        document_sha256: baseSha, amendment_number: null, effect: "add", value: "70",
        citations: [citation(baseSha, "The ratio is 70% for technical merit and 30% for price.")]
      },
      {
        id: "technical-amendment", field: "technical_weight", topic: "amended technical ratio",
        document_sha256: amendmentSha, amendment_number: "999", effect: "replace", value: "60",
        citations: [citation(amendmentSha, "The amended ratio is 60% for technical merit and 40% for price.")]
      }
    );
    const amendment001 = { ...manifests[1], amendment_number: "001", pages: amendmentIndex.pagesTotal };
    const result = materializeAnalysis({
      draft: value,
      // Reversed input order and a deliberately false model amendment number
      // must not affect the server-owned base -> 001 chain.
      documents: [
        { name: "a001.pdf", sourceUrl: null, index: amendmentIndex, role: "amendment", amendmentNumber: "001" },
        { name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }
      ],
      manifests: [manifests[0], amendment001], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.evaluation.mandatory_gate).toBe(true);
    expect(result.evaluation.technical_weight).toBe(60);
    expect(result.evaluation.citations.some((item) => item.document_sha256 === amendmentSha)).toBe(true);
    expect(result.quality.unsupported_items_removed).toBeGreaterThanOrEqual(1);
  });

  it("does not let a validated evaluation value borrow an adjacent unrelated mutation action", () => {
    const quote = "The technical ratio is 60% for technical merit and 40% for price. " +
      "Project schedule is revised.";
    const value = addMinimumCoverage(draft([]));
    value.evaluation.rules.push(
      {
        id: "technical-original", field: "technical_weight", topic: "technical weight",
        document_sha256: baseSha, amendment_number: null, effect: "add", value: "70",
        citations: [citation(baseSha, "The ratio is 70% for technical merit and 30% for price.")]
      },
      {
        id: "technical-borrowed-action", field: "technical_weight", topic: "technical weight",
        document_sha256: amendmentSha, amendment_number: "001", effect: "replace", value: "60",
        citations: [citation(amendmentSha, quote)]
      }
    );
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: index(amendmentSha, [quote]),
          role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.evaluation.technical_weight).toBe(70);
    expect(result.quality.unsupported_items_removed).toBeGreaterThanOrEqual(1);
  });

  it("detects same-amendment scalar conflicts across topic wording even when effect is add", () => {
    const result = reconcileVersionedFacts([
      {
        id: "horizon-a", topic: "Appendix 1 projection end year", value: "2050", documentSha256: amendmentSha,
        documentRole: "amendment", amendmentNumber: "003", effect: "add",
        citations: [verifiedCitation(amendmentSha, "Projections extend to 2050.", 2)]
      },
      {
        id: "horizon-b", topic: "Statement of Work annual forecast endpoint", value: "2055",
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "003", effect: "add",
        citations: [verifiedCitation(amendmentSha, "Projections extend to 2055.", 5)]
      }
    ]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].candidate_values.toSorted()).toEqual(["2050", "2055"]);
    expect(result.facts.every((fact) => fact.status === "conflicted")).toBe(true);
  });

  it("does not treat separate delivery obligations as a scalar conflict when the model reuses a generic topic", () => {
    const result = reconcileVersionedFacts([
      {
        id: "maintenance-window", topic: "delivery",
        value: "Maintenance must be completed within 2 business days of a request.",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(
          baseSha,
          "Maintenance must be completed within 2 business days of a request.",
          20
        )]
      },
      {
        id: "regular-repair-window", topic: "delivery",
        value: "Regular repairs must be completed within 3 business days.",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(
          baseSha,
          "Regular repairs must be completed within 3 business days.",
          21
        )]
      },
      {
        id: "urgent-assessment-window", topic: "delivery",
        value: "Urgent repair assessment must be completed within 2 business days.",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(
          baseSha,
          "Urgent repair assessment must be completed within 2 business days.",
          22
        )]
      }
    ]);

    expect(result.conflicts).toEqual([]);
    expect(result.facts.every((fact) => fact.status === "active")).toBe(true);
  });

  it("does not conflict source-authorized unrelated replacements that share only a generic model topic", () => {
    const result = reconcileVersionedFacts([
      {
        id: "deductible-base", topic: "insurance update", value: "5000 CAD",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, "Insurance deductible is 5000 CAD.", 10)]
      },
      {
        id: "contact-base", topic: "insurance update", value: "Bob",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, "Insurance contact is Bob.", 11)]
      },
      {
        id: "deductible-amendment", topic: "insurance update", value: "7500 CAD",
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "replace",
        citations: [verifiedCitation(
          amendmentSha,
          "Insurance deductible is changed to 7500 CAD.",
          2
        )]
      },
      {
        id: "contact-amendment", topic: "insurance update", value: "Alice",
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "replace",
        citations: [verifiedCitation(
          amendmentSha,
          "Insurance contact is changed to Alice.",
          3
        )]
      }
    ]);

    expect(result.unauthorizedMutationIds).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.facts.find((fact) => fact.id === "deductible-base")?.status).toBe("superseded");
    expect(result.facts.find((fact) => fact.id === "contact-base")?.status).toBe("superseded");
    expect(result.facts.find((fact) => fact.id === "deductible-amendment")?.status).toBe("active");
    expect(result.facts.find((fact) => fact.id === "contact-amendment")?.status).toBe("active");
  });

  it("fails closed when only a generic delivery topic suggests the same scalar obligation", () => {
    const result = reconcileVersionedFacts([
      {
        id: "repair-window-a", topic: "delivery",
        value: "Repairs must be completed within 2 business days.",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(
          baseSha,
          "Repairs must be completed within 2 business days.",
          20
        )]
      },
      {
        id: "repair-window-b", topic: "delivery",
        value: "Repairs must be completed within 3 business days.",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(
          baseSha,
          "Repairs must be completed within 3 business days.",
          21
        )]
      }
    ]);

    expect(result.conflicts).toEqual([]);
    expect(result.facts.every((fact) => fact.status === "active")).toBe(true);
  });

  it("still reports a scalar conflict when verified source clauses establish one closing-date identity", () => {
    const result = reconcileVersionedFacts([
      {
        id: "closing-a", topic: "deadline", value: "September 1, 2026",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(
          baseSha,
          "Solicitation closing date: September 1, 2026.",
          1
        )]
      },
      {
        id: "closing-b", topic: "deadline", value: "September 2, 2026",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(
          baseSha,
          "Solicitation closing date: September 2, 2026.",
          2
        )]
      }
    ]);

    expect(result.conflicts).toHaveLength(1);
    expect(new Set(result.conflicts[0]?.candidate_values))
      .toEqual(new Set(["September 1, 2026", "September 2, 2026"]));
    expect(result.facts.every((fact) => fact.status === "conflicted")).toBe(true);
  });

  it("does not let a model supersedes ID mutate an unrelated verified fact", () => {
    const result = reconcileVersionedFacts([
      {
        id: "closing", topic: "solicitation closing date", value: "September 1, 2026",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, "Closing date: September 1, 2026.", 1)]
      },
      {
        id: "questions", topic: "questions deadline", value: "September 15, 2026",
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "003",
        effect: "add", supersedesIds: ["closing"],
        citations: [verifiedCitation(amendmentSha, "Questions due September 15, 2026.", 2)]
      }
    ]);
    expect(result.facts.find((fact) => fact.id === "closing")?.status).toBe("active");
    expect(result.facts.find((fact) => fact.id === "questions")?.status).toBe("active");
  });

  it("withholds duplicate direct model IDs instead of mixing prose and citations", () => {
    const value = addMinimumCoverage(draft([]));
    value.risks = [
      {
        id: "risk-1", topic: "late bid", document_sha256: baseSha, amendment_number: null,
        effect: "add", severity: "high", category: "submission",
        finding: "Late bids are rejected.", impact: "Submission can fail.",
        recommended_action: "Submit early.",
        citations: [citation(baseSha, "The bidder must submit a signed form.")]
      },
      {
        id: "risk-1", topic: "insurance", document_sha256: amendmentSha, amendment_number: "003",
        effect: "add", severity: "medium", category: "financial",
        finding: "Insurance costs may rise.", impact: "Pricing may change.",
        recommended_action: "Review insurance pricing.",
        citations: [citation(amendmentSha, "The old contract term is deleted.")]
      }
    ];
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null },
        { name: "a003.pdf", sourceUrl: null, index: amendmentIndex, role: "amendment", amendmentNumber: "003" }
      ],
      manifests, costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.risks).toEqual([]);
    expect(result.blocking_unknowns).toContain(
      "One or more model records reused an ambiguous identity and were withheld."
    );
  });

  it("removes a risk whose source clause was superseded even without a risk tombstone", () => {
    const value = addMinimumCoverage(draft([
      {
        id: "term-base", topic: "contract end date", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "contractual",
        text: "Contract end date 2045.", evidence_needed: null, consequence: null,
        citations: [citation(baseSha, "Contract end date 2045.")]
      },
      {
        id: "term-new", topic: "contract end date", document_sha256: amendmentSha,
        amendment_number: "003", effect: "replace", category: "contractual",
        text: "Contract end date 2050.", evidence_needed: null, consequence: null,
        citations: [citation(amendmentSha, "Amendment replaces the contract end date with 2050.")]
      }
    ]));
    value.risks = [{
      id: "old-term-risk", topic: "administrative exposure", document_sha256: baseSha,
      amendment_number: null, effect: "add", severity: "high", category: "schedule",
      finding: "Contract end date 2045.", impact: "Delivery planning may be constrained.",
      recommended_action: "Confirm the delivery plan.",
      citations: [citation(baseSha, "Contract end date 2045.")]
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null },
        { name: "a003.pdf", sourceUrl: null, index: amendmentIndex, role: "amendment", amendmentNumber: "003" }
      ],
      manifests, costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((requirement) => requirement.id === "term-base")?.status)
      .toBe("superseded");
    expect(result.requirements.find((requirement) => requirement.id === "term-new")?.status)
      .toBe("active");
    expect(result.risks).toEqual([]);
  });

  it("removes a cross-page risk that repeats a superseded closing date", () => {
    const deadlineBaseIndex = index(baseSha, [
      "Closing date September 1, 2026.",
      "Bids received after September 1, 2026 will be rejected.",
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."
    ]);
    const deadlineAmendmentIndex = index(amendmentSha, [
      "The closing date is revised to September 15, 2026."
    ]);
    const value = addMinimumCoverage(draft([
      {
        id: "old-closing", topic: "closing date", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "submission",
        text: "Closing date September 1, 2026.", evidence_needed: null, consequence: null,
        citations: [citation(baseSha, "Closing date September 1, 2026.")]
      },
      {
        id: "new-closing", topic: "closing date", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "submission",
        text: "Closing date September 15, 2026.", evidence_needed: null, consequence: null,
        citations: [citation(amendmentSha, "The closing date is revised to September 15, 2026.")]
      }
    ]));
    value.risks = [{
      id: "old-deadline-risk", topic: "late bid", document_sha256: baseSha,
      amendment_number: null, effect: "add", severity: "high", category: "submission",
      finding: "Bids received after September 1, 2026 will be rejected.",
      impact: "A late submission can be rejected.", recommended_action: "Submit early.",
      citations: [citation(baseSha, "Bids received after September 1, 2026 will be rejected.")]
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: deadlineBaseIndex, role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: deadlineAmendmentIndex, role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((requirement) => requirement.id === "old-closing")?.status).toBe("superseded");
    expect(result.requirements.find((requirement) => requirement.id === "new-closing")?.status).toBe("active");
    expect(result.risks).toEqual([]);
  });

  it("removes a stale deadline risk even when the model drifts its topic", () => {
    const staleBaseIndex = index(baseSha, [
      "Closing date is September 1, 2026.",
      "Bids received after September 1, 2026 will be rejected.",
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."
    ]);
    const extendedIndex = index(amendmentSha, [
      "The closing date is changed to September 15, 2026."
    ]);
    const value = addMinimumCoverage(draft([
      {
        id: "old-closing-drift", topic: "closing date", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "submission",
        text: "Closing date is September 1, 2026.", evidence_needed: null, consequence: null,
        citations: [citation(baseSha, "Closing date is September 1, 2026.")]
      },
      {
        id: "new-closing-drift", topic: "closing date", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "submission",
        text: "Closing date is September 15, 2026.", evidence_needed: null, consequence: null,
        citations: [citation(amendmentSha,
          "The closing date is changed to September 15, 2026.")]
      }
    ]));
    value.risks.push({
      id: "late-bid-topic-drift", topic: "administrative exposure", document_sha256: baseSha,
      amendment_number: null, effect: "add", severity: "high", category: "submission",
      finding: "Bids received after September 1, 2026 will be rejected.",
      impact: "Bids will be rejected.", recommended_action: "Submit before September 1, 2026.",
      citations: [citation(baseSha, "Bids received after September 1, 2026 will be rejected.")]
    });
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: staleBaseIndex, role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: extendedIndex, role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "old-closing-drift")?.status).toBe("superseded");
    expect(result.requirements.find((item) => item.id === "new-closing-drift")?.status).toBe("active");
    expect(result.risks.find((risk) => risk.id === "late-bid-topic-drift")).toBeUndefined();
  });

  it("withholds a topic-drifted risk that repeats an invalidated non-temporal scalar", () => {
    const oldCoverage = "Insurance coverage limit is 5000000 CAD.";
    const newCoverage = "Insurance coverage is changed to 10000000 CAD.";
    const riskQuote = "A 5000000 claim exceeds available protection.";
    const unrelatedRiskQuote = "A contract ceiling of 5000000 CAD constrains purchasing.";
    const value = addMinimumCoverage(draft([
      {
        id: "old-coverage", topic: "insurance coverage", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "contractual", text: oldCoverage,
        evidence_needed: null, consequence: null, citations: [citation(baseSha, oldCoverage)]
      },
      {
        id: "new-coverage", topic: "insurance coverage", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "contractual", text: newCoverage,
        evidence_needed: null, consequence: null, citations: [citation(amendmentSha, newCoverage)]
      }
    ]));
    value.risks.push(
      {
        id: "old-coverage-risk", topic: "administrative exposure", document_sha256: baseSha,
        amendment_number: null, effect: "add", severity: "high", category: "financial",
        finding: riskQuote, impact: "The claim may be under-protected.",
        recommended_action: "Review current protection.", citations: [citation(baseSha, riskQuote)]
      },
      {
        id: "unrelated-ceiling-risk", topic: "administrative exposure", document_sha256: baseSha,
        amendment_number: null, effect: "add", severity: "medium", category: "financial",
        finding: unrelatedRiskQuote, impact: "Purchasing flexibility may be limited.",
        recommended_action: "Review the contract ceiling.",
        citations: [citation(baseSha, unrelatedRiskQuote)]
      }
    );
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: index(baseSha, [oldCoverage, riskQuote, unrelatedRiskQuote,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: index(amendmentSha, [newCoverage]), role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "old-coverage")?.status).toBe("superseded");
    expect(result.requirements.find((item) => item.id === "new-coverage")?.status).toBe("active");
    expect(result.risks.find((risk) => risk.id === "old-coverage-risk")).toBeUndefined();
    expect(result.risks.find((risk) => risk.id === "unrelated-ceiling-risk")).toBeDefined();
  });

  it("reconciles one fact lineage across claims and requirements", () => {
    const oldCoverage = "Insurance coverage limit is 5000000 CAD.";
    const newCoverage = "Insurance coverage limit is changed to 10000000 CAD.";
    const staleRisk = "Insurance coverage of 5000000 CAD may be insufficient.";
    const value = addMinimumCoverage(draft([
      {
        id: "coverage-requirement-new", topic: "insurance coverage",
        document_sha256: amendmentSha, amendment_number: "001", effect: "replace",
        category: "contractual", text: newCoverage, evidence_needed: null,
        consequence: null, citations: [citation(amendmentSha, newCoverage)]
      }
    ]));
    value.claims.push({
      claim_id: "coverage-claim-old", topic: "insurance coverage", claim_text: oldCoverage,
      claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
      effect: "add", citations: [citation(baseSha, oldCoverage)], supersedes_claim_ids: []
    });
    value.risks.push({
      id: "coverage-risk-old", topic: "insurance exposure", document_sha256: baseSha,
      amendment_number: null, effect: "add", severity: "medium", category: "financial",
      finding: staleRisk, impact: "Insurance coverage may be insufficient.",
      recommended_action: "Review the 5000000 CAD insurance coverage.",
      citations: [citation(baseSha, staleRisk)]
    });
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: index(baseSha, [oldCoverage, staleRisk,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: index(amendmentSha, [newCoverage]),
          role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.claims.find((item) => item.claim_id === "coverage-claim-old")?.status)
      .toBe("superseded");
    expect(result.requirements.find((item) => item.id === "coverage-requirement-new")?.status)
      .toBe("active");
    expect(result.risks.find((item) => item.id === "coverage-risk-old")).toBeUndefined();
  });

  it("resolves risk lineage from the verified finding span, never impact or action prose", () => {
    const wide = "Closing date is September 1, 2026 at 14:00. " +
      "Bids received after the closing time will be rejected. " +
      "Insurance certificate expires September 1, 2026.";
    const source = [verifiedCitation(baseSha, wide)];
    expect(resolveRiskLineage(
      "Bids received after September 1, 2026 at 14:00 will be rejected.", source, baseSha
    )).toEqual({ kind: "bound", key: "deadline:solicitation" });
    expect(resolveRiskLineage(
      "Insurance certificate expires September 1, 2026.", source, baseSha
    )).toEqual({ kind: "bound", key: "insurance:certificate" });
    expect(resolveRiskLineage(
      "A 5000000 claim exceeds available protection.",
      [verifiedCitation(baseSha, "A 5000000 claim exceeds available protection.")], baseSha
    )).toEqual({ kind: "bound", key: "insurance:coverage" });
    expect(resolveRiskLineage(
      "A contract ceiling of 5000000 CAD constrains purchasing.",
      [verifiedCitation(baseSha, "A contract ceiling of 5000000 CAD constrains purchasing.")], baseSha
    )).toEqual({ kind: "unbound" });
    for (const unrelated of [
      "Insurance premium cost is 5000000 CAD.",
      "Data protection applies to 5000000 records.",
      "Price protection is capped at 5000000 CAD."
    ]) {
      expect(resolveRiskLineage(
        unrelated, [verifiedCitation(baseSha, unrelated)], baseSha
      )).toEqual({ kind: "unbound" });
    }
    expect(resolveRiskLineage(
      "Commercial General Liability coverage is limited to 5000000 CAD.",
      [verifiedCitation(baseSha,
        "Commercial General Liability coverage is limited to 5000000 CAD.")], baseSha
    )).toEqual({ kind: "bound", key: "insurance:cgl:coverage" });
    expect(resolveRiskLineage(
      "Professional liability coverage is limited to 5000000 CAD.",
      [verifiedCitation(baseSha,
        "Professional liability coverage is limited to 5000000 CAD.")], baseSha
    )).toEqual({ kind: "bound", key: "insurance:professional-liability:coverage" });
    expect(resolveRiskLineage(
      "Commercial General Liability coverage is 5000000 CAD and professional liability coverage is 2000000 CAD.",
      [verifiedCitation(baseSha,
        "Commercial General Liability coverage is 5000000 CAD and professional liability coverage is 2000000 CAD.")],
      baseSha
    )).toEqual({
      kind: "ambiguous",
      candidateKeys: ["insurance:cgl:coverage", "insurance:professional-liability:coverage"]
    });
    expect(resolveRiskLineage(
      "Questions are due September 1, 2026 and bids are due September 2, 2026.",
      [verifiedCitation(baseSha,
        "Questions are due September 1, 2026 and bids are due September 2, 2026.")], baseSha
    )).toEqual({
      kind: "ambiguous",
      candidateKeys: ["deadline:questions", "deadline:solicitation"]
    });
    expect(resolveRiskLineage(
      "Insurance certificate expires September 1, 2026. Bids received after September 1, 2026 are rejected.",
      [verifiedCitation(baseSha,
        "Insurance certificate expires September 1, 2026. Bids received after September 1, 2026 are rejected.")],
      baseSha
    )).toEqual({
      kind: "ambiguous",
      candidateKeys: ["deadline:solicitation", "insurance:certificate"]
    });
    expect(resolveRiskLineage(
      "Insurance certificate submission deadline is September 1, 2026.",
      [verifiedCitation(baseSha,
        "Insurance certificate submission deadline is September 1, 2026.")], baseSha
    )).toEqual({
      kind: "ambiguous",
      candidateKeys: ["deadline:solicitation", "insurance:certificate"]
    });
  });

  it("keeps an unrelated risk that merely shares a superseded calendar date", () => {
    const oldClosing = "Closing date is September 1, 2026.";
    const newClosing = "The closing date is changed to September 15, 2026.";
    const certificateRisk = "Insurance certificate expires September 1, 2026.";
    const ambiguousCertificateRisk = "Insurance certificate submission deadline is September 1, 2026.";
    const wideBaseQuote = `${oldClosing} ${certificateRisk} ${ambiguousCertificateRisk} ` +
      "Submit the bid before September 1, 2026.";
    const value = addMinimumCoverage(draft([
      {
        id: "old-closing-date", topic: "closing date", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "submission", text: oldClosing,
        evidence_needed: null, consequence: null, citations: [citation(baseSha, wideBaseQuote)]
      },
      {
        id: "new-closing-date", topic: "closing date", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "submission", text: newClosing,
        evidence_needed: null, consequence: null, citations: [citation(amendmentSha, newClosing)]
      }
    ]));
    value.risks.push(
      {
        id: "certificate-expiry", topic: "insurance certificate", document_sha256: baseSha,
        amendment_number: null, effect: "add", severity: "medium", category: "contractual",
        finding: certificateRisk, impact: "The certificate may need renewal.",
        recommended_action: "Submit the bid before September 1, 2026.",
        citations: [citation(baseSha, wideBaseQuote)]
      },
      {
        id: "certificate-hallucinated-action", topic: "insurance certificate",
        document_sha256: baseSha, amendment_number: null, effect: "add", severity: "medium",
        category: "contractual", finding: certificateRisk,
        impact: "The certificate may need renewal.",
        recommended_action: "Email the bid before September 1, 2026.",
        citations: [citation(baseSha, wideBaseQuote)]
      },
      {
        id: "ambiguous-certificate-deadline", topic: "insurance certificate",
        document_sha256: baseSha, amendment_number: null, effect: "add", severity: "medium",
        category: "contractual", finding: ambiguousCertificateRisk,
        impact: "The certificate deadline needs review.",
        recommended_action: "Clarify the certificate deadline.",
        citations: [citation(baseSha, wideBaseQuote)]
      }
    );
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: index(baseSha, [wideBaseQuote,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: index(amendmentSha, [newClosing]), role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "old-closing-date")?.status)
      .toBe("superseded");
    expect(result.risks.find((risk) => risk.id === "certificate-expiry")).toBeUndefined();
    expect(result.risks.find((risk) => risk.id === "certificate-hallucinated-action"))
      .toBeUndefined();
    expect(result.risks.find((risk) => risk.id === "ambiguous-certificate-deadline"))
      .toBeDefined();
    expect(result.blocking_unknowns).toContain(
      "One or more risks share a superseded scalar but have ambiguous source lineage and require review."
    );
  });

  it("does not let a shared wide quote cross deadline scopes or unchanged timestamp parts", () => {
    const sharedQuote = "Questions must be received by September 1, 2026 at 12:00. " +
      "Bids received after September 1, 2026 at 14:00 will be rejected.";
    const questionBaseIndex = index(baseSha, [sharedQuote,
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
    const questionAmendmentIndex = index(amendmentSha, [
      "The deadline for questions is changed to September 2, 2026 at 12:00."
    ]);
    const questionRun = addMinimumCoverage(draft([
      {
        id: "old-question-wide", topic: "question deadline", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "submission",
        text: "Questions must be received by September 1, 2026 at 12:00.",
        evidence_needed: null, consequence: null, citations: [citation(baseSha, sharedQuote)]
      },
      {
        id: "new-question-wide", topic: "question deadline", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "submission",
        text: "The deadline for questions is changed to September 2, 2026 at 12:00.",
        evidence_needed: null, consequence: null,
        citations: [citation(amendmentSha,
          "The deadline for questions is changed to September 2, 2026 at 12:00.")]
      }
    ]));
    questionRun.risks.push({
      id: "closing-risk-wide", topic: "administrative exposure", document_sha256: baseSha,
      amendment_number: null, effect: "add", severity: "high", category: "submission",
      finding: "Bids received after September 1, 2026 at 14:00 will be rejected.",
      impact: "The bid can be rejected.", recommended_action: "Submit before 14:00.",
      citations: [citation(baseSha, sharedQuote)]
    });
    const questionResult = materializeAnalysis({
      draft: questionRun,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: questionBaseIndex, role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: questionAmendmentIndex, role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(questionResult.requirements.find((item) => item.id === "old-question-wide")?.status)
      .toBe("superseded");
    expect(questionResult.risks.find((risk) => risk.id === "closing-risk-wide")).toBeDefined();

    const closingBaseQuote = "Closing date is September 1, 2026 at 14:00. " +
      "Bids received after the closing time will be rejected.";
    const closingBaseIndex = index(baseSha, [closingBaseQuote,
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]);
    const closingAmendmentIndex = index(amendmentSha, [
      "The closing time is changed to September 1, 2026 at 16:00."
    ]);
    const closingRun = addMinimumCoverage(draft([
      {
        id: "old-time-wide", topic: "closing time", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "submission",
        text: "Closing date is September 1, 2026 at 14:00.", evidence_needed: null,
        consequence: null, citations: [citation(baseSha, closingBaseQuote)]
      },
      {
        id: "new-time-wide", topic: "closing time", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "submission",
        text: "The closing time is changed to September 1, 2026 at 16:00.", evidence_needed: null,
        consequence: null, citations: [citation(amendmentSha,
          "The closing time is changed to September 1, 2026 at 16:00.")]
      }
    ]));
    closingRun.risks.push(
      {
        id: "generic-late-risk", topic: "late bid", document_sha256: baseSha,
        amendment_number: null, effect: "add", severity: "high", category: "submission",
        finding: "Bids received after the closing time will be rejected.",
        impact: "Late bids will be rejected.", recommended_action: "Submit before the closing time.",
        citations: [citation(baseSha, closingBaseQuote)]
      },
      {
        id: "explicit-old-time-risk", topic: "administrative exposure", document_sha256: baseSha,
        amendment_number: null, effect: "add", severity: "high", category: "submission",
        finding: "Bids received after September 1, 2026 at 14:00 will be rejected.",
        impact: "The old closing time could cause rejection.",
        recommended_action: "Submit before September 1, 2026 at 14:00.",
        citations: [citation(baseSha, closingBaseQuote)]
      }
    );
    const closingResult = materializeAnalysis({
      draft: closingRun,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: closingBaseIndex, role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: closingAmendmentIndex, role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(closingResult.requirements.find((item) => item.id === "old-time-wide")?.status)
      .toBe("superseded");
    expect(closingResult.risks.find((risk) => risk.id === "generic-late-risk")).toBeDefined();
    expect(closingResult.risks.find((risk) => risk.id === "explicit-old-time-risk")).toBeUndefined();
  });

  it.each(["impact", "recommended_action"] as const)(
    "removes a stale risk when the superseded date appears only in %s",
    (location) => {
      const riskQuote = location === "impact"
        ? "Late bids will be rejected. Submissions after September 1, 2026 are non-compliant. Submit early."
        : "Late bids will be rejected. A late submission is non-compliant. Submit before September 1, 2026.";
      const deadlineBaseIndex = index(baseSha, [
        "Closing date September 1, 2026.",
        riskQuote,
        "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."
      ]);
      const deadlineAmendmentIndex = index(amendmentSha, [
        "The closing date is revised to September 15, 2026."
      ]);
      const value = addMinimumCoverage(draft([
        {
          id: "old-closing", topic: "closing date", document_sha256: baseSha,
          amendment_number: null, effect: "add", category: "submission",
          text: "Closing date September 1, 2026.", evidence_needed: null, consequence: null,
          citations: [citation(baseSha, "Closing date September 1, 2026.")]
        },
        {
          id: "new-closing", topic: "closing date", document_sha256: amendmentSha,
          amendment_number: "001", effect: "replace", category: "submission",
          text: "Closing date September 15, 2026.", evidence_needed: null,
          consequence: null,
          citations: [citation(amendmentSha, "The closing date is revised to September 15, 2026.")]
        }
      ]));
      value.risks = [{
        id: `stale-risk-${location}`, topic: "late bid", document_sha256: baseSha,
        amendment_number: null, effect: "add", severity: "high", category: "submission",
        finding: "Late bids will be rejected.",
        impact: location === "impact"
          ? "Submissions after September 1, 2026 are non-compliant."
          : "A late submission is non-compliant.",
        recommended_action: location === "recommended_action"
          ? "Submit before September 1, 2026."
          : "Submit early.",
        citations: [citation(baseSha, riskQuote)]
      }];
      const result = materializeAnalysis({
        draft: value,
        documents: [
          { name: "base.pdf", sourceUrl: null, index: deadlineBaseIndex, role: "base", amendmentNumber: null },
          { name: "a001.pdf", sourceUrl: null, index: deadlineAmendmentIndex, role: "amendment", amendmentNumber: "001" }
        ],
        manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
        costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
      }).result;
      expect(result.requirements.find((item) => item.id === "old-closing")?.status).toBe("superseded");
      expect(result.requirements.find((item) => item.id === "new-closing")?.status).toBe("active");
      expect(result.risks).toEqual([]);
    }
  );

  it("rejects negated closing, submission, selection, weight, and threshold assertions", () => {
    const closing = "Solicitation closing date is not September 15, 2026.";
    const submission = "No bids shall be submitted by email.";
    const selection = "No award will be made to the bid with the lowest price.";
    const technical = "Technical weight is not 70%.";
    const threshold = "The minimum score is not 50 points.";
    const value = addMinimumCoverage(draft([]));
    value.summary.closing_date = "September 15, 2026";
    value.summary.submission_method = "email";
    value.summary.current_selection_method = "lowest price";
    value.claims.push(
      {
        claim_id: "negated-closing", topic: "solicitation closing date",
        claim_text: "September 15, 2026", claim_type: "source", confidence: 1,
        document_sha256: baseSha, amendment_number: null, effect: "add",
        citations: [citation(baseSha, closing)], supersedes_claim_ids: []
      },
      {
        claim_id: "negated-submission", topic: "submission method", claim_text: "email",
        claim_type: "source", confidence: 1, document_sha256: baseSha,
        amendment_number: null, effect: "add", citations: [citation(baseSha, submission)],
        supersedes_claim_ids: []
      }
    );
    value.evaluation.rules.push(
      {
        id: "negated-selection", field: "selection_method", topic: "selection method",
        document_sha256: baseSha, amendment_number: null, effect: "add", value: "lowest price",
        citations: [citation(baseSha, selection)]
      },
      {
        id: "negated-technical", field: "technical_weight", topic: "technical weight",
        document_sha256: baseSha, amendment_number: null, effect: "add", value: "70",
        citations: [citation(baseSha, technical)]
      },
      {
        id: "negated-threshold", field: "rated_threshold", topic: "rated threshold",
        document_sha256: baseSha, amendment_number: null, effect: "add", value: "50",
        citations: [citation(baseSha, threshold)]
      }
    );
    const result = materializeAnalysis({
      draft: value,
      documents: [{
        name: "base.pdf", sourceUrl: null,
        index: index(baseSha, [closing, submission, selection, technical, threshold,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]),
        role: "base", amendmentNumber: null
      }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.claims.find((claim) => claim.claim_id === "negated-closing")?.status)
      .toBe("needs_review");
    expect(result.claims.find((claim) => claim.claim_id === "negated-submission")?.status)
      .toBe("needs_review");
    expect(result.summary.closing_date).toBeNull();
    expect(result.summary.submission_method).toBeNull();
    expect(result.summary.current_selection_method).toBeNull();
    expect(result.evaluation.technical_weight).toBeNull();
    expect(result.evaluation.rated_threshold).toBeNull();
    expect(result.evaluation.selection_method).toBeNull();
  });

  it("requires affirmative source modality for mandatory categories and keeps unsupported details null", () => {
    const notRequired = "Bidders are not required to submit a bid bond.";
    const optional = "Submission of a bid bond is optional.";
    const signed = "The bidder must submit a signed form.";
    const mislabeledMandatory = "The bidder must provide a bid security form.";
    const splitMandatory = "Bid bond is mandatory and the signed form is supplied for reference.";
    const value = addMinimumCoverage(draft([
      {
        id: "bond-inverted", topic: "bid bond", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "mandatory",
        text: "Bidders are required to submit a bid bond.", evidence_needed: null,
        consequence: null, citations: [citation(baseSha, notRequired)]
      },
      {
        id: "optional-mandatory", topic: "bid bond", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "mandatory", text: optional,
        evidence_needed: null, consequence: null, citations: [citation(baseSha, optional)]
      },
      {
        id: "unsupported-details", topic: "signed form requirement", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "mandatory", text: signed,
        evidence_needed: "Audited financial statements",
        consequence: "Automatic disqualification", citations: [citation(baseSha, signed)]
      },
      {
        id: "mandatory-mislabeled-contractual", topic: "bid security form",
        document_sha256: baseSha, amendment_number: null, effect: "add",
        category: "contractual", text: mislabeledMandatory, evidence_needed: null,
        consequence: null, citations: [citation(baseSha, mislabeledMandatory)]
      },
      {
        id: "borrowed-mandatory", topic: "signed form", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "mandatory",
        text: "The signed form is mandatory.", evidence_needed: null, consequence: null,
        citations: [citation(baseSha, splitMandatory)]
      }
    ]));
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: index(baseSha, [notRequired,
        optional, signed, mislabeledMandatory, splitMandatory,
        "A bid that fails a mandatory requirement will be non-compliant."]),
      role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "bond-inverted")?.status)
      .toBe("needs_review");
    expect(result.requirements.find((item) => item.id === "optional-mandatory")?.status)
      .toBe("needs_review");
    expect(result.requirements.find((item) => item.id === "unsupported-details"))
      .toMatchObject({ status: "active", evidence_needed: null, consequence: null });
    expect(result.requirements.find((item) => item.id === "mandatory-mislabeled-contractual"))
      .toMatchObject({ status: "active", category: "mandatory" });
    expect(result.requirements.find((item) => item.id === "borrowed-mandatory")?.status)
      .toBe("needs_review");
  });

  it("does not drop objective bounds or invert directional scalar roles", () => {
    const bounded = "The bidder must propose up to three (3) resources.";
    const invertedMulti = "The 5000000 CAD insurance coverage exceeds the 1000000 CAD claim.";
    const invertedSingle = "The 10000000 CAD insurance coverage exceeds the claim.";
    const value = addMinimumCoverage(draft([{
      id: "lost-maximum", topic: "resources", document_sha256: baseSha,
      amendment_number: null, effect: "add", category: "mandatory",
      text: "The bidder must propose three (3) resources.", evidence_needed: null,
      consequence: null, citations: [citation(baseSha, bounded)]
    }]));
    value.risks.push(
      {
        id: "inverted-multi", topic: "insurance exposure", document_sha256: baseSha,
        amendment_number: null, effect: "add", severity: "high", category: "financial",
        finding: "The 5000000 CAD claim exceeds the 1000000 CAD insurance coverage.",
        impact: "The claim exceeds coverage.", recommended_action: "Review insurance.",
        citations: [citation(baseSha, invertedMulti)]
      },
      {
        id: "inverted-single", topic: "insurance exposure", document_sha256: baseSha,
        amendment_number: null, effect: "add", severity: "high", category: "financial",
        finding: "The 10000000 CAD claim exceeds the insurance coverage.",
        impact: "The claim exceeds coverage.", recommended_action: "Review insurance.",
        citations: [citation(baseSha, invertedSingle)]
      }
    );
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: index(baseSha, [bounded,
        invertedMulti, invertedSingle,
        "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]),
      role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "lost-maximum")?.status)
      .toBe("needs_review");
    expect(result.risks.find((risk) => risk.id === "inverted-multi")).toBeUndefined();
    expect(result.risks.find((risk) => risk.id === "inverted-single")).toBeUndefined();
  });

  it("withholds a source-unbound action that repeats a superseded deadline", () => {
    const oldClosing = "Solicitation closing date is September 15, 2026.";
    const certificate = "Insurance certificate expires September 15, 2026.";
    const newClosing = "Solicitation closing date is changed to September 1, 2026.";
    const value = addMinimumCoverage(draft([
      {
        id: "old-closing-action", topic: "solicitation closing date", document_sha256: baseSha,
        amendment_number: null, effect: "add", category: "submission", text: oldClosing,
        evidence_needed: null, consequence: null,
        citations: [citation(baseSha, `${oldClosing} ${certificate}`)]
      },
      {
        id: "new-closing-action", topic: "solicitation closing date", document_sha256: amendmentSha,
        amendment_number: "001", effect: "replace", category: "submission", text: newClosing,
        evidence_needed: null, consequence: null, citations: [citation(amendmentSha, newClosing)]
      }
    ]));
    value.risks.push({
      id: "certificate-stale-action", topic: "insurance certificate", document_sha256: baseSha,
      amendment_number: null, effect: "add", severity: "high", category: "submission",
      finding: certificate, impact: "The certificate may expire.",
      recommended_action: "Submit the bid before September 15, 2026.",
      citations: [citation(baseSha, `${oldClosing} ${certificate}`)]
    });
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: index(baseSha, [`${oldClosing} ${certificate}`,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: index(amendmentSha, [newClosing]), role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 1 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.risks.find((risk) => risk.id === "certificate-stale-action")).toBeUndefined();
    expect(result.blocking_unknowns).toContain(
      "One or more risks share a superseded scalar but have ambiguous source lineage and require review."
    );
  });

  it("withholds an amendment-cited risk that repeats a superseded base-document deadline", () => {
    const oldClosing = "Solicitation closing date is September 1, 2026.";
    const newClosing = "Solicitation closing date is changed to September 15, 2026.";
    const historicalRisk = "Bids received after September 1, 2026 will be rejected.";
    const value = addMinimumCoverage(draft([
      {
        id: "cross-document-closing-old", topic: "solicitation closing date",
        document_sha256: baseSha, amendment_number: null, effect: "add",
        category: "submission", text: oldClosing, evidence_needed: null,
        consequence: null, citations: [citation(baseSha, oldClosing)]
      },
      {
        id: "cross-document-closing-new", topic: "solicitation closing date",
        document_sha256: amendmentSha, amendment_number: "001", effect: "replace",
        category: "submission", text: newClosing, evidence_needed: null,
        consequence: null, citations: [citation(amendmentSha, newClosing)]
      }
    ]));
    value.risks.push({
      id: "cross-document-stale-risk", topic: "late bid", document_sha256: amendmentSha,
      amendment_number: "001", effect: "add", severity: "high", category: "submission",
      finding: historicalRisk, impact: "The bid will be rejected.",
      recommended_action: "Submit before September 1, 2026.",
      citations: [citation(amendmentSha, historicalRisk)]
    });
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: index(baseSha, [oldClosing,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]), role: "base", amendmentNumber: null },
        { name: "a001.pdf", sourceUrl: null, index: index(amendmentSha, [newClosing,
          historicalRisk]), role: "amendment", amendmentNumber: "001" }
      ],
      manifests: [manifests[0], { ...manifests[1], amendment_number: "001", pages: 2 }],
      costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.requirements.find((item) => item.id === "cross-document-closing-old")?.status)
      .toBe("superseded");
    expect(result.requirements.find((item) => item.id === "cross-document-closing-new")?.status)
      .toBe("active");
    expect(result.risks.find((risk) => risk.id === "cross-document-stale-risk"))
      .toBeUndefined();
  });

  it("keeps closed reconciliation identities scoped to their exact source objects", () => {
    const reconcilePair = (oldTopic: string, oldValue: string, oldQuote: string,
      nextTopic: string, nextValue: string, nextQuote: string) => reconcileVersionedFacts([
      {
        id: "old", topic: oldTopic, value: oldValue, documentSha256: baseSha,
        documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, oldQuote)]
      },
      {
        id: "next", topic: nextTopic, value: nextValue, documentSha256: amendmentSha,
        documentRole: "amendment", amendmentNumber: "001", effect: "replace",
        citations: [verifiedCitation(amendmentSha, nextQuote)]
      }
    ]);
    for (const result of [
      reconcilePair("insurance coverage", "Insurance coverage amount is 5000000 CAD.",
        "Insurance coverage amount is 5000000 CAD.", "insurance premium",
        "Insurance premium amount is 12000 CAD.",
        "Insurance premium amount is changed to 12000 CAD."),
      reconcilePair("contract end", "Contract end date is December 31, 2045.",
        "Contract end date is December 31, 2045.", "termination fee",
        "Contract termination fee is 10000 CAD.",
        "Contract termination fee is changed to 10000 CAD."),
      reconcilePair("projection horizon", "The projection horizon extends until 2050.",
        "The projection horizon extends until 2050.", "forecast payment",
        "Payment for forecasts is extended until 2055.",
        "Payment for forecasts is extended until 2055.")
    ]) {
      expect(result.facts.find((fact) => fact.id === "old")?.status).toBe("active");
      expect(result.unauthorizedMutationIds).toContain("next");
    }
    const conjunction = reconcilePair(
      "insurance coverage", "Insurance coverage is 5000000 CAD.",
      "Insurance coverage is 5000000 CAD.", "insurance premium",
      "Insurance premium is 10000 CAD.",
      "Insurance coverage is 5000000 CAD and premium is changed to 10000 CAD."
    );
    expect(conjunction.facts.find((fact) => fact.id === "old")?.status).toBe("active");
    expect(conjunction.unauthorizedMutationIds).toContain("next");
  });

  it("reconciles Basis of Payment subfields without superseding their siblings", () => {
    const result = reconcileVersionedFacts([
      {
        id: "currency", topic: "payment currency", value: "CAD", documentSha256: baseSha,
        documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, "Basis of Payment: Payment currency is CAD.")]
      },
      {
        id: "frequency-old", topic: "invoice frequency", value: "monthly", documentSha256: baseSha,
        documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, "Basis of Payment: Invoice frequency is monthly.")]
      },
      {
        id: "frequency-new", topic: "invoice frequency", value: "quarterly",
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "replace", citations: [verifiedCitation(amendmentSha,
          "In the Basis of Payment, invoice frequency is changed to quarterly.")]
      }
    ]);
    expect(result.facts.find((fact) => fact.id === "currency")?.status).toBe("active");
    expect(result.facts.find((fact) => fact.id === "frequency-old")?.status).toBe("superseded");
    expect(result.facts.find((fact) => fact.id === "frequency-new")?.status).toBe("active");
  });

  it("binds a shared CGL and professional-liability amount to the asserted subtype", () => {
    const result = reconcileVersionedFacts([
      {
        id: "cgl-old", topic: "commercial general liability coverage",
        value: "Commercial general liability coverage is 5000000 CAD.",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha,
          "Commercial general liability and professional liability coverage are each 5000000 CAD.")]
      },
      {
        id: "cgl-new", topic: "commercial general liability coverage",
        value: "Commercial general liability coverage is 10000000 CAD.",
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "001",
        effect: "replace", citations: [verifiedCitation(amendmentSha,
          "Commercial general liability coverage is changed to 10000000 CAD.")]
      }
    ]);
    expect(result.facts.find((fact) => fact.id === "cgl-old")?.status).toBe("superseded");
    expect(result.facts.find((fact) => fact.id === "cgl-new")?.status).toBe("active");
  });

  it("does not cross a with-boundary between equal solicitation and question dates", () => {
    const shared = "Solicitation closing date is September 15, 2026 with questions due September 15, 2026.";
    const result = reconcileVersionedFacts([
      {
        id: "closing-with", topic: "solicitation closing date", value: "September 15, 2026",
        documentSha256: baseSha, documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, shared)]
      },
      {
        id: "questions-with", topic: "question deadline",
        value: "Questions are due September 15, 2026", documentSha256: baseSha,
        documentRole: "base", amendmentNumber: null, effect: "add",
        citations: [verifiedCitation(baseSha, shared)]
      },
      {
        id: "questions-next", topic: "question deadline",
        value: "Questions are due September 10, 2026", documentSha256: amendmentSha,
        documentRole: "amendment", amendmentNumber: "001", effect: "replace",
        citations: [verifiedCitation(amendmentSha,
          "The questions deadline is changed to September 10, 2026.")]
      }
    ]);
    expect(result.facts.find((fact) => fact.id === "closing-with")?.status).toBe("active");
  });

  it("removes risks tied to a clause deleted by a later amendment", () => {
    const value = addMinimumCoverage(draft([]));
    value.risks = [
      {
        id: "old-term-risk", topic: "contract term risk", document_sha256: baseSha,
        amendment_number: null, effect: "add", severity: "high", category: "schedule",
        finding: "Contract end date 2045.", impact: "Delivery planning may be constrained.",
        recommended_action: "Confirm the delivery plan.", citations: [citation(baseSha, "Contract end date 2045.")]
      },
      {
        id: "delete-old-term-risk", topic: "contract term risk", document_sha256: amendmentSha,
        amendment_number: "003", effect: "delete", severity: "high", category: "schedule",
        finding: "The old contract term is deleted.", impact: "The old risk no longer controls.",
        recommended_action: "Use the amended term.", citations: [citation(amendmentSha, "The old contract term is deleted.")]
      }
    ];
    const result = materializeAnalysis({
      draft: value,
      documents: [
        { name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null },
        { name: "a003.pdf", sourceUrl: null, index: amendmentIndex, role: "amendment", amendmentNumber: "003" }
      ],
      manifests, costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.risks).toEqual([]);
  });

  it("canonicalizes only exact typed-field wrappers from cover labels", () => {
    const cover = "Title: Repair & Maintenance on various File Bays. " +
      "Solicitation No.: 100022184-A. Proposal To: Employment and Social Development Canada. " +
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant.";
    const value = addMinimumCoverage(draft([]));
    value.summary.title = "Repair & Maintenance on various File Bays";
    value.summary.solicitation_number = "100022184-A";
    value.summary.issuer = "Employment and Social Development Canada";
    value.claims = [
      {
        claim_id: "cover-title", topic: "title",
        claim_text: "The solicitation title is Repair & Maintenance on various File Bays.",
        claim_type: "source", confidence: 1, document_sha256: baseSha,
        amendment_number: null, effect: "add",
        citations: [citation(baseSha, "Title: Repair & Maintenance on various File Bays")],
        supersedes_claim_ids: []
      },
      {
        claim_id: "cover-number", topic: "solicitation number",
        claim_text: "The solicitation number is 100022184-A.", claim_type: "source",
        confidence: 1, document_sha256: baseSha, amendment_number: null, effect: "add",
        citations: [citation(baseSha, "Solicitation No.: 100022184-A")],
        supersedes_claim_ids: []
      },
      {
        claim_id: "cover-issuer", topic: "issuer",
        claim_text: "The issuer is Employment and Social Development Canada.", claim_type: "source",
        confidence: 1, document_sha256: baseSha, amendment_number: null, effect: "add",
        citations: [citation(baseSha, "Proposal To: Employment and Social Development Canada")],
        supersedes_claim_ids: []
      }
    ];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: index(baseSha, [cover]), role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(Object.fromEntries(result.claims.map((claim) => [claim.claim_id, {
      text: claim.claim_text,
      status: claim.status
    }]))).toEqual({
      "cover-title": { text: "Repair & Maintenance on various File Bays", status: "active" },
      "cover-number": { text: "100022184-A", status: "active" },
      "cover-issuer": { text: "Employment and Social Development Canada", status: "active" }
    });
    expect(result.summary).toMatchObject({
      title: "Repair & Maintenance on various File Bays",
      solicitation_number: "100022184-A",
      issuer: "Employment and Social Development Canada"
    });
  });

  it("binds an email submission channel across comma-separated cover instructions", () => {
    const instruction = "Bids must be submitted only to Employment and Social Development Canada by the date, time and place or email address indicated on page 1.";
    const value = addMinimumCoverage(draft([]));
    value.summary.submission_method = "email";
    value.claims = [{
      claim_id: "cover-email", topic: "submission method", claim_text: "email",
      claim_type: "source", confidence: 1, document_sha256: baseSha,
      amendment_number: null, effect: "add", citations: [citation(baseSha, instruction)],
      supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null,
        index: index(baseSha, [instruction,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]),
        role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.claims[0]).toMatchObject({ claim_id: "cover-email", status: "active" });
    expect(result.summary.submission_method).toBe("email");
  });

  it("uses a sufficient verified citation subset and discloses rejected extras", () => {
    const value = addMinimumCoverage(draft([]));
    value.summary.title = "Real Contract";
    value.claims = [{
      claim_id: "title-with-extra", topic: "title", claim_text: "Real Contract",
      claim_type: "source", confidence: 1, document_sha256: baseSha,
      amendment_number: null, effect: "add",
      citations: [
        citation(baseSha, "RFP title: Real Contract"),
        citation(baseSha, "This quote is not in the source")
      ],
      supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.claims[0]).toMatchObject({ claim_id: "title-with-extra", status: "active" });
    expect(result.summary.title).toBe("Real Contract");
    expect(result.quality.warnings).toContain(
      "1 model-supplied citation candidate(s) could not be independently located and were omitted."
    );
  });

  it("derives one server-owned identity for conflicting security-checklist annex labels", () => {
    const annexD = "Security Requirements Check List and security guide (if applicable), attached at Annex D";
    const annexE = "ANNEX \"E\" - SECURITY REQUIREMENTS CHECK LIST";
    const value = addMinimumCoverage(draft([]));
    value.claims = [
      {
        claim_id: "contract-annex", topic: "contract security attachment label",
        claim_text: "Annex D", claim_type: "source", confidence: 1,
        document_sha256: baseSha, amendment_number: null, effect: "add",
        citations: [citation(baseSha, annexD)], supersedes_claim_ids: []
      },
      {
        claim_id: "package-annex", topic: "present checklist heading",
        claim_text: "Annex E", claim_type: "source", confidence: 1,
        document_sha256: baseSha, amendment_number: null, effect: "add",
        citations: [citation(baseSha, annexE)], supersedes_claim_ids: []
      }
    ];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null,
        index: index(baseSha, [annexD, annexE,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]),
        role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.conflicts).toHaveLength(1);
    expect(new Set(result.conflicts[0]?.candidate_values)).toEqual(new Set(["Annex D", "Annex E"]));
    expect(result.conflicts[0]?.citations.map((item) => item.pdf_page_1based).toSorted()).toEqual([1, 2]);
    expect(result.conflicts[0]?.safe_answer)
      .toBe("The supplied document is internally inconsistent; clarification is required.");
    expect(result.blocking_unknowns)
      .toContain("The supplied package contains unresolved source conflicts.");
  });

  it("does not treat a position-title form label as the solicitation title", () => {
    const formLabel = "Position title: Chief Financial Officer";
    const value = addMinimumCoverage(draft([]));
    value.summary.title = "Chief Financial Officer";
    value.claims = [{
      claim_id: "position-title", topic: "title", claim_text: "Chief Financial Officer",
      claim_type: "source", confidence: 1, document_sha256: baseSha,
      amendment_number: null, effect: "add", citations: [citation(baseSha, formLabel)],
      supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null,
        index: index(baseSha, [formLabel,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]),
        role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.claims.find((claim) => claim.claim_id === "position-title")?.status).toBe("needs_review");
    expect(result.summary.title).toBe("Document-only RFP analysis");
  });

  it("recovers unique summary identity values from active verified source claims", () => {
    const cover = "RFP title: Repair & Maintenance on various File Bays. " +
      "Solicitation number: 100022184-A. Issuer: Employment and Social Development Canada. " +
      "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant.";
    const value = addMinimumCoverage(draft([]));
    value.summary = {
      title: "", solicitation_number: null, issuer: null, closing_date: null,
      overview: "", scope: [], submission_method: null, current_selection_method: null
    };
    value.claims = [
      {
        claim_id: "cover-title-fallback", topic: "package identity fact",
        claim_text: "Repair & Maintenance on various File Bays", claim_type: "source",
        confidence: 1, document_sha256: baseSha, amendment_number: null, effect: "add",
        citations: [citation(baseSha, "RFP title: Repair & Maintenance on various File Bays")],
        supersedes_claim_ids: []
      },
      {
        claim_id: "cover-number-fallback", topic: "package identity fact",
        claim_text: "100022184-A", claim_type: "source", confidence: 1,
        document_sha256: baseSha, amendment_number: null, effect: "add",
        citations: [citation(baseSha, "Solicitation number: 100022184-A")],
        supersedes_claim_ids: []
      },
      {
        claim_id: "cover-issuer-fallback", topic: "package identity fact",
        claim_text: "Employment and Social Development Canada", claim_type: "source",
        confidence: 1, document_sha256: baseSha, amendment_number: null, effect: "add",
        citations: [citation(baseSha, "Issuer: Employment and Social Development Canada")],
        supersedes_claim_ids: []
      }
    ];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: index(baseSha, [cover]),
        role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.summary).toMatchObject({
      title: "Repair & Maintenance on various File Bays",
      solicitation_number: "100022184-A",
      issuer: "Employment and Social Development Canada"
    });
  });

  it("does not publish a container pointer as an individual mandatory requirement", () => {
    const pointer = "Mandatory technical evaluation criteria are included in Annex D.";
    const value = addMinimumCoverage(draft([{
      id: "mandatory-container-pointer", topic: "mandatory technical evaluation criteria",
      document_sha256: baseSha, amendment_number: null, effect: "add", category: "mandatory",
      text: pointer, evidence_needed: null, consequence: null,
      citations: [citation(baseSha, pointer)]
    }]));
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null,
        index: index(baseSha, [pointer,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]),
        role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.requirements.find((item) => item.id === "mandatory-container-pointer"))
      .toBeUndefined();
  });

  it("keeps a clean M3 obligation active when PDF text splits one glyph from completing", () => {
    const modelText = "The Bidder must propose up to three (3) resources and provide detailed resumes for each, " +
      "which highlight each resource's experience completing preventive maintenance and repairs on file bay equipment.";
    const sourceText = modelText.replace("completing", "completin g");
    const value = draft([{
      id: "m3-resources", topic: "M3 mandatory criterion", document_sha256: baseSha,
      amendment_number: null, effect: "add", category: "mandatory", text: modelText,
      evidence_needed: null, consequence: null,
      citations: [{ ...citation(baseSha, modelText), section: "M3" }]
    }]);
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null,
        index: index(baseSha, [`Evaluation item M3 ${sourceText}`]),
        role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.requirements.find((item) => item.id === "m3-resources")).toMatchObject({
      category: "mandatory",
      status: "active",
      text: modelText,
      citations: [{ pdf_page_1based: 1, verification_method: "normalized" }]
    });
  });

  it("keeps independently recovered M1-M4 active without merging them into a false conflict", () => {
    const table = "Mandatory Criteria " +
      "M1 The bidder must demonstrate relevant experience. " +
      "M2 The bidder must provide a service plan. " +
      "M3 The bidder must propose up to three (3) resources and provide detailed resumes for each. " +
      "M4 The bidder must provide manufacturer validation. ANNEX E - OTHER";
    const result = materializeAnalysis({
      draft: draft([]),
      documents: [{ name: "base.pdf", sourceUrl: null, index: index(baseSha, [table]),
        role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    const mandatory = result.requirements.filter((item) =>
      item.category === "mandatory" && item.status === "active"
    );

    expect(mandatory).toHaveLength(4);
    expect(mandatory.map((item) => item.id)).toEqual([
      `server-anchor-${baseSha.slice(0, 12)}-p1-M1`,
      `server-anchor-${baseSha.slice(0, 12)}-p1-M2`,
      `server-anchor-${baseSha.slice(0, 12)}-p1-M3`,
      `server-anchor-${baseSha.slice(0, 12)}-p1-M4`
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it("lets verified server M1-M4 survive a wrong-citation model primary and an ID collision", () => {
    const table = "Mandatory Criteria " +
      "M1 The bidder must demonstrate relevant experience. " +
      "M2 The bidder must provide a service plan. " +
      "M3 The bidder must propose up to three (3) resources and provide detailed resumes for each. " +
      "M4 The bidder must provide manufacturer validation. ANNEX E - OTHER";
    const value = draft([
      {
        id: "model-m3-wrong-citation", topic: "M3 mandatory criterion",
        document_sha256: baseSha, amendment_number: null, effect: "add", category: "mandatory",
        text: "The bidder must propose up to three (3) resources and provide detailed resumes for each.",
        evidence_needed: null, consequence: null,
        citations: [{ ...citation(baseSha, "This quote is not in the source."), section: "M3" }]
      },
      {
        id: `server-anchor-${baseSha.slice(0, 12)}-p1-M3`, topic: "forged server identity",
        document_sha256: baseSha, amendment_number: null, effect: "add", category: "mandatory",
        text: "The bidder must propose exactly three resources.", evidence_needed: null,
        consequence: null, citations: [{ ...citation(baseSha, table), section: "M3" }]
      }
    ]);
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: index(baseSha, [table]),
        role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    const mandatory = result.requirements.filter((item) =>
      item.category === "mandatory" && item.status === "active"
    );

    expect(mandatory).toHaveLength(4);
    expect(mandatory.find((item) => item.id.endsWith("-M3"))?.text)
      .toContain("up to three (3)");
    expect(JSON.stringify(result.requirements)).not.toContain("exactly three");
    expect(result.blocking_unknowns)
      .toContain("One or more extracted items failed source, scalar, or field-specific evidence validation.");
  });

  it("materializes a security-checklist conflict even when the model omits both anchors", () => {
    const annexD = "The Contractor must comply with the provisions of the: Security Requirements Check List " +
      "and security guide (if applicable), attached at Annex D;";
    const annexE = "M4 The Bidder must provide manufacturer validation. " +
      "ANNEX \u201cE\u201d - SECURITY REQUIREMENTS CHECK LIST";
    const value = addMinimumCoverage(draft([]));
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null,
        index: index(baseSha, [annexD, annexE,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]),
        role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.conflicts).toHaveLength(1);
    expect(new Set(result.conflicts[0]?.candidate_values)).toEqual(new Set(["Annex D", "Annex E"]));
    expect(result.conflicts[0]?.citations.map((item) => item.pdf_page_1based).toSorted())
      .toEqual([1, 2]);
    expect(result.conflicts[0]?.safe_answer)
      .toBe("The supplied document is internally inconsistent; clarification is required.");
  });

  it.each([
    "ANNEX E - SECURITY REQUIREMENTS CHECKLIST",
    "ANNEX \u201cE\u201d - SECURITY REQUIREMENTS CHECK LIST ............ 43"
  ])("does not let a model E claim suppress the physical Annex E anchor: %s", (modelQuote) => {
    const toc = "ANNEX \u201cE\u201d - SECURITY REQUIREMENTS CHECK LIST ............ 43";
    const annexD = "The Contractor must comply with the provisions of the: Security Requirements Check List " +
      "and security guide (if applicable), attached at Annex D;";
    const annexE = "M4 The Bidder must provide manufacturer validation. " +
      "ANNEX \u201cE\u201d - SECURITY REQUIREMENTS CHECK LIST";
    const value = addMinimumCoverage(draft([]));
    value.claims = [{
      claim_id: "model-annex-e", topic: "security requirements checklist annex label",
      claim_text: "Annex E", claim_type: "source", confidence: 1,
      document_sha256: baseSha, amendment_number: null, effect: "add",
      citations: [citation(baseSha, modelQuote)], supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null,
        index: index(baseSha, [toc, annexD, annexE,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]),
        role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.conflicts).toHaveLength(1);
    expect(new Set(result.conflicts[0]?.candidate_values)).toEqual(new Set(["Annex D", "Annex E"]));
    expect(result.conflicts[0]?.citations.map((item) => item.pdf_page_1based).toSorted())
      .toEqual([2, 3]);
  });

  it.each([
    "If applicable, the Security Requirements Check List is attached at Annex D",
    "The Security Requirements Check List is not attached at Annex D",
    "The Security Requirements Check List is attached at Annex D if approved"
  ])("does not publish a conditional or negative checklist annex relation: %s", (annexD) => {
    const annexE = "ANNEX \"E\" - SECURITY REQUIREMENTS CHECK LIST";
    const value = addMinimumCoverage(draft([]));
    value.claims = [
      {
        claim_id: "contract-annex", topic: "contract security attachment label",
        claim_text: "Annex D", claim_type: "source", confidence: 1,
        document_sha256: baseSha, amendment_number: null, effect: "add",
        citations: [citation(baseSha, annexD)], supersedes_claim_ids: []
      },
      {
        claim_id: "package-annex", topic: "present checklist heading",
        claim_text: "Annex E", claim_type: "source", confidence: 1,
        document_sha256: baseSha, amendment_number: null, effect: "add",
        citations: [citation(baseSha, annexE)], supersedes_claim_ids: []
      }
    ];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null,
        index: index(baseSha, [annexD, annexE,
          "The bidder must submit a signed form. A bid that fails a mandatory requirement will be non-compliant."]),
        role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;

    expect(result.conflicts).toEqual([]);
    expect(result.claims.find((claim) => claim.claim_id === "contract-annex")?.status).toBe("needs_review");
  });
});
