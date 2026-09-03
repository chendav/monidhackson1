import { describe, expect, it } from "vitest";
import type { Citation, DocumentManifest } from "@/contracts";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import { materializeAnalysis } from "@/lib/analysis/materialize";
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
  "Issuer: Canada. Solicitation number: CER-1. Closing date: September 15, 2026."
]);
const amendmentIndex = index(amendmentSha, [
  "cover", "Contract end date 2050.", "three", "four",
  "Contract end date 2055.", "The amendment repeats the 2055 end date.",
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
          citations: [citation(amendmentSha, "Contract end date 2050.")]
        },
        {
          id: "term-2055", topic: "contract end date", document_sha256: amendmentSha,
          amendment_number: "001", effect: "replace", category: "contractual",
          text: "Contract end date 2055.", evidence_needed: null, consequence: null,
          citations: [
            citation(amendmentSha, "Contract end date 2055."),
            citation(amendmentSha, "The amendment repeats the 2055 end date.")
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
      ["wrong-year", "needs_review"],
      ["wrong-date", "needs_review"],
      ["wrong-document", "needs_review"]
    ]);
    expect(result.quality.unsupported_items_removed).toBeGreaterThanOrEqual(3);
  });

  it("does not launder an issuer citation into a title or another summary field", () => {
    const value = addMinimumCoverage(draft([]));
    value.summary.title = "Canada";
    value.summary.issuer = "Canada";
    value.claims = [{
      claim_id: "issuer", topic: "contracting authority issuer", claim_text: "Canada",
      claim_type: "source", confidence: 1, document_sha256: baseSha, amendment_number: null,
      effect: "add", citations: [citation(baseSha, "Issuer: Canada.")], supersedes_claim_ids: []
    }];
    const result = materializeAnalysis({
      draft: value,
      documents: [{ name: "base.pdf", sourceUrl: null, index: baseIndex, role: "base", amendmentNumber: null }],
      manifests: [manifests[0]], costs: [], expiresAt: new Date("2026-09-03T00:00:00Z")
    }).result;
    expect(result.summary.title).toBe("Document-only RFP analysis");
    expect(result.summary.issuer).toBe("Canada");
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

  it("detects same-amendment scalar conflicts across topic wording even when effect is add", () => {
    const result = reconcileVersionedFacts([
      {
        id: "horizon-a", topic: "projection end year", value: "2050", documentSha256: amendmentSha,
        documentRole: "amendment", amendmentNumber: "003", effect: "add",
        citations: [verifiedCitation(amendmentSha, "Projections extend to 2050.", 2)]
      },
      {
        id: "horizon-b", topic: "annual projection horizon requirement", value: "2055",
        documentSha256: amendmentSha, documentRole: "amendment", amendmentNumber: "003", effect: "add",
        citations: [verifiedCitation(amendmentSha, "Projections extend to 2055.", 5)]
      }
    ]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].candidate_values.toSorted()).toEqual(["2050", "2055"]);
    expect(result.facts.every((fact) => fact.status === "conflicted")).toBe(true);
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
});
