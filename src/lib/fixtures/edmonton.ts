import { AnalysisResultSchema, type AnalysisResult, type Citation } from "@/contracts";

export const EDMONTON_SHA256 = "2a769c87c80d5e958b0c99d0bd0107b34cfbeddb9bb0c15c2f2b3dc609adc9c6";
export const EDMONTON_PAGES = 55;
export const EDMONTON_PRINTED_BODY_PAGES = 47;
export const EDMONTON_FORM_PHYSICAL_PAGES = [48, 49, 50, 51, 52, 53, 54, 55] as const;

function citation(page: number, quote: string, section: string | null = null): Citation {
  return {
    document_sha256: EDMONTON_SHA256,
    document_name: "edmonton-100022184-A.pdf",
    source_url: null,
    pdf_page_1based: page,
    printed_page_label: page <= 47 ? `${page} of 47` : `${page - 47}/8`,
    section,
    evidence_quote: quote,
    verified: true,
    verification_method: "normalized"
  };
}

export const edmontonGolden = Object.freeze({
  solicitationNumber: "100022184-A",
  title: "Repair & Maintenance on various File Bays",
  issuer: "Employment and Social Development Canada",
  closingDate: "2023-06-19T14:00:00-04:00",
  pages: EDMONTON_PAGES,
  printedBodyEndsAt: EDMONTON_PRINTED_BODY_PAGES,
  mandatoryCriteria: 4,
  m3MaximumResources: 3,
  pricingValue: null,
  selectionMethod: "Lowest evaluated price",
  securityAnnexReferenced: "D",
  securityAnnexPresent: "E",
  formPhysicalPages: EDMONTON_FORM_PHYSICAL_PAGES
});

export function createEdmontonSampleResult(): AnalysisResult {
  const requirements: AnalysisResult["requirements"] = [
    {
      id: "m1-experience",
      category: "mandatory",
      status: "active",
      text: "Demonstrate at least three years of similar-equipment experience within the last five years and provide two client references.",
      evidence_needed: "Experience narrative and two client references.",
      consequence: "A failed mandatory criterion makes the bid non-responsive.",
      citations: [citation(43, "The bidder must demonstrate they have at least 3 years of experience within the last 5 years working on similar equipment.", "M1")]
    },
    {
      id: "m2-service-plan",
      category: "mandatory",
      status: "active",
      text: "Provide a detailed plan covering the four-hour inquiry response and two-business-day maintenance service levels.",
      evidence_needed: "Detailed service plan.",
      consequence: "A failed mandatory criterion makes the bid non-responsive.",
      citations: [citation(43, "The bidder must provide a detailed plan in his bid submission on how they plan to meet our service requirements", "M2")]
    },
    {
      id: "m3-resources",
      category: "mandatory",
      status: "active",
      text: "Propose up to three resources and provide a detailed resume for each proposed resource.",
      evidence_needed: "Up to three detailed resumes.",
      consequence: "Do not interpret 'up to three' as requiring exactly three resources.",
      citations: [citation(43, "The Bidder must propose up to three (3) resources and provide detailed resumes for each", "M3")]
    },
    {
      id: "m4-manufacturer",
      category: "mandatory",
      status: "active",
      text: "Provide manufacturer validation authorizing repair or maintenance on the file bays.",
      evidence_needed: "Written manufacturer authorization.",
      consequence: "A failed mandatory criterion makes the bid non-responsive.",
      citations: [citation(43, "The Bidder must provide written validation from the manufacturer", "M4")]
    },
    {
      id: "submission-email-limit",
      category: "submission",
      status: "active",
      text: "Submit by email to the stated receiving address; the stated size limit is 13 MB.",
      evidence_needed: "Email submission below the receiving limit.",
      consequence: "Oversized or misdirected submissions may not be received.",
      citations: [citation(1, "By Email: nc-solicitations-gd@hrsdc-rhdcc.gc.ca (Size limit – 13MB)", "Return bids to")]
    },
    {
      id: "submission-deadline",
      category: "submission",
      status: "active",
      text: "The solicitation closes June 19, 2023 at 2:00 PM Eastern Daylight Time.",
      evidence_needed: "Timestamped submission receipt.",
      consequence: "Late bids are at risk of rejection.",
      citations: [citation(1, "Solicitation Closes At 02 :00 PM / 14 h Monday - June 19, 2023", "Solicitation closes")]
    },
    {
      id: "security-organization",
      category: "security",
      status: "active",
      text: "The bidder must hold the required organization security clearance at bid closing.",
      evidence_needed: "Valid organization security clearance.",
      consequence: "Security readiness is a bid-closing condition.",
      citations: [citation(16, "the Bidder must hold a valid organization security clearance", "6.1")]
    },
    {
      id: "security-personnel",
      category: "security",
      status: "active",
      text: "Personnel needing sensitive-site access must hold Reliability Status.",
      evidence_needed: "Reliability Status for each relevant person.",
      consequence: "Uncleared personnel cannot access sensitive sites.",
      citations: [citation(17, "must EACH hold a valid RELIABILITY STATUS", "7.3.1")]
    },
    {
      id: "pricing-all-periods",
      category: "financial",
      status: "active",
      text: "Provide prices for the initial and every optional period; all amount fields in the issued form are blank.",
      evidence_needed: "Completed pricing schedules; unknown blanks must not be treated as zero.",
      consequence: "Missing optional-period costs makes the bid incomplete.",
      citations: [citation(40, "Bidders must ensure to provide costs in the tables for all the periods, initial and optional periods.", "Annex C")]
    }
  ];

  const risks: AnalysisResult["risks"] = [
    {
      id: "annex-security-cross-reference",
      severity: "high",
      category: "Document consistency",
      finding: "The contract clause calls the Security Requirements Checklist Annex D, while the package labels it Annex E.",
      impact: "A bidder could cross-reference the wrong annex or omit a required security response.",
      recommended_action: "Ask the contracting authority to confirm the controlling annex letter.",
      citations: [
        citation(17, "Security Requirements Check List and security guide (if applicable), attached at Annex D", "7.3.1"),
        citation(43, "ANNEX “ E ” - SECURITY REQUIREMENTS CHECK LIST", "Annex E")
      ]
    },
    {
      id: "blank-pricing",
      severity: "high",
      category: "Pricing completeness",
      finding: "The source pricing cells are blank placeholders, so the tender does not state bidder prices.",
      impact: "Treating blanks as zero would create a materially false cost conclusion.",
      recommended_action: "Complete every required pricing field and retain blanks as unknown until bidder input exists.",
      citations: [citation(40, "Total $_______________", "Annex C")]
    }
  ];

  const result: AnalysisResult = {
    schema_version: "1.0",
    source_scope: "document_only",
    package_completeness: "verified",
    document_manifest: [{
      document_id: "10002218-4a00-4000-8000-000000000001",
      role: "base",
      source_type: "url",
      source_name: "edmonton-100022184-A.pdf",
      source_url: null,
      sha256: EDMONTON_SHA256,
      pages: EDMONTON_PAGES,
      language: "en",
      solicitation_number: "100022184-A",
      amendment_number: null,
      status: "active",
      cleanup_status: "deleted"
    }],
    summary: {
      title: edmontonGolden.title,
      solicitation_number: edmontonGolden.solicitationNumber,
      issuer: edmontonGolden.issuer,
      closing_date: edmontonGolden.closingDate,
      overview: "Repair and annual preventive maintenance for four file-bay equipment streams in Edmonton, Alberta.",
      scope: ["Montel", "Spacesavers", "SpacePro (Crank)", "Spacefile (ACME)"],
      submission_method: "Email",
      current_selection_method: edmontonGolden.selectionMethod
    },
    claims: [
      {
        claim_id: "scope-file-bays",
        claim_text: "Service Canada requires repair and maintenance for file bays in Edmonton.",
        claim_type: "source",
        status: "active",
        confidence: 1,
        citations: [citation(4, "Service Canada requires Repair and Maintenance contract(s) for various File Bays", "1.2.1")],
        formula_and_inputs: null
      },
      {
        claim_id: "printed-vs-physical-pages",
        claim_text: "The main solicitation is printed as 47 pages and is followed by an eight-page registration form, for 55 physical PDF pages.",
        claim_type: "derived",
        status: "active",
        confidence: 1,
        citations: [citation(47, "Page 47 of 47", null), citation(55, "Page 8/8", null)],
        formula_and_inputs: { formula: "47 + 8", inputs: { solicitation_pages: 47, form_pages: 8 } }
      }
    ],
    requirements,
    evaluation: {
      mandatory_gate: true,
      rated_threshold: null,
      technical_weight: null,
      financial_weight: null,
      selection_method: edmontonGolden.selectionMethod,
      citations: [citation(14, "The responsive bid with the lowest evaluated price will be recommended for award of a contract.", "4.2.1")]
    },
    risks,
    conflicts: [{
      id: "conflict-security-annex-letter",
      topic: "Security Requirements Checklist annex letter",
      status: "conflicted",
      candidate_values: ["Annex D", "Annex E"],
      safe_answer: "Treat the checklist as required but obtain written confirmation of its controlling annex letter.",
      citations: risks[0].citations
    }],
    clarification_questions: ["Is the Security Requirements Checklist correctly designated Annex E rather than Annex D?"],
    decision_readiness: "needs_clarification",
    blocking_unknowns: ["Bidder-specific prices remain blank.", "The security annex letter is inconsistent."],
    quality: {
      pages_total: EDMONTON_PAGES,
      pages_covered: 8,
      critical_claims: 12,
      critical_claims_cited: 12,
      citations_verified: 16,
      unsupported_items_removed: 0,
      search_events: 0,
      follow_embedded_link_events: 0,
      warnings: [
        "Sample facts were verified against SHA-bound physical PDF pages.",
        "Source prices are blank and remain unknown, not zero.",
        "Provider retention is unknown; this sample used no provider upload."
      ]
    },
    costs: {
      currency: "USD",
      events: [],
      actual_micro_usd: 0,
      estimated_micro_usd: 0,
      total_micro_usd: 0,
      includes_failed_attempts: false
    },
    generated_at: "2026-09-02T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z"
  };
  return AnalysisResultSchema.parse(result);
}
