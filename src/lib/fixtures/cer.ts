import type { Citation, DocumentManifest } from "@/contracts";
import type { VersionedFact } from "@/lib/analysis/reconciliation";

export const CER_GOLDEN_PROVENANCE = Object.freeze({
  kind: "manually_frozen_public_sample" as const,
  live_provider_proof: false,
  verified_at: "2026-09-02"
});

export const CER_REQUIRED_CONFLICT_SAFE_ANSWER =
  "The supplied amendment is internally inconsistent; clarification is required.";

export const CER_DOCUMENTS = Object.freeze([
  {
    name: "cer-main.pdf",
    url: "https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/102701/84084-26-0009-a-rfp-macroeconomic-projection-services.pdf",
    sha256: "894b876fdfdacb2aec0571f4cf2f29be08ebc2380c6e3251bb48885f69d31bfb",
    pages: 58,
    role: "base" as const,
    amendment: null
  },
  {
    name: "cer-amendment-001.pdf",
    url: "https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/102701/84084-26-0009-a-rfp-amendment-01-macroeconomic-projections-services.pdf",
    sha256: "ec135a6ddf7a22120530bef89612cfedc7f007c64cf313f2b8de46d143027cfc",
    pages: 6,
    role: "amendment" as const,
    amendment: "001"
  },
  {
    name: "cer-amendment-002.pdf",
    url: "https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/102701/84084-26-0009-a-rfp-amendment-02-macroeconomic-projections-services_0_0.pdf",
    sha256: "300a06081b195ea28f858feb20bd6780f596ceefc638495c4fdd63a5edea352c",
    pages: 2,
    role: "amendment" as const,
    amendment: "002"
  },
  {
    name: "cer-amendment-003.pdf",
    url: "https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/102701/84084-26-0009-a-rfp-amendment-03-macroeconomic-projections.pdf",
    sha256: "98f6299df44edaab9e8ec834b476d88358d5af75923646b5fb190e709be1204f",
    pages: 9,
    role: "amendment" as const,
    amendment: "003"
  }
]);

function citation(documentIndex: number, page: number, quote: string, section: string | null = null): Citation {
  const document = CER_DOCUMENTS[documentIndex];
  return {
    document_sha256: document.sha256,
    document_name: document.name,
    source_url: document.url,
    pdf_page_1based: page,
    printed_page_label: `${page} of ${document.pages}`,
    section,
    evidence_quote: quote,
    verified: true,
    verification_method: "normalized"
  };
}

export const cerManifest: DocumentManifest[] = CER_DOCUMENTS.map((document, index) => ({
  document_id: `84084000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  role: document.role,
  source_type: "url",
  source_name: document.name,
  source_url: document.url,
  sha256: document.sha256,
  pages: document.pages,
  language: "en",
  solicitation_number: "84084-26-0009/A",
  amendment_number: document.amendment,
  status: "active",
  cleanup_status: "deleted"
}));

export const CER_M3_ROW_DEFINITIONS = Object.freeze([
  { row: 1, basePage: 54, amendmentPage: 6, baseQuote: "1 All indicators provided at the provincial/territorial and national levels", amendmentQuote: "1 All indicators provided at the provincial/territorial and national levels" },
  { row: 2, basePage: 54, amendmentPage: 6, baseQuote: "2 Fully updated historical dataset, starting in 2000", amendmentQuote: "2 Fully updated historical dataset, starting in 2000" },
  { row: 3, basePage: 54, amendmentPage: 6, baseQuote: "3 Projections provided on an annual basis, approximately 20 to 30 years beyond the current year.", amendmentQuote: "3 Annual basis projections to 2050 for the first contract period." },
  { row: 4, basePage: 54, amendmentPage: 6, baseQuote: "4 Current Measures projection, reflecting the", amendmentQuote: "4 Current Measures projection, reflecting the" },
  { row: 5, basePage: 54, amendmentPage: 6, baseQuote: "5 Population.", amendmentQuote: "5 Population." },
  { row: 6, basePage: 54, amendmentPage: 6, baseQuote: "6 Real gross domestic product (GDP)", amendmentQuote: "6 Real gross domestic product (GDP)" },
  { row: 7, basePage: 54, amendmentPage: 6, baseQuote: "7 Investment - total and by major economic sector/category.", amendmentQuote: "7 Investment - total and by major economic sector/category." },
  { row: 8, basePage: 54, amendmentPage: 6, baseQuote: "8 Household income.", amendmentQuote: "8 Household income." },
  { row: 9, basePage: 54, amendmentPage: 6, baseQuote: "9 Key labour force indicators", amendmentQuote: "9 Key labour force indicators" },
  { row: 10, basePage: 54, amendmentPage: 6, baseQuote: "10 Canada/United States (U.S.) exchange rate.", amendmentQuote: "10 Canada/United States (U.S.) exchange rate." },
  { row: 11, basePage: 54, amendmentPage: 6, baseQuote: "11 GDP deflators for Canada and the U.S.", amendmentQuote: "11 GDP deflators for Canada and the U.S." },
  { row: 12, basePage: 54, amendmentPage: 6, baseQuote: "12 Long-term bond rates for Canada and the U.S.", amendmentQuote: "12 Long-term bond rates for Canada and the U.S." },
  { row: 13, basePage: 54, amendmentPage: 6, baseQuote: "13 Consumer Price Index.", amendmentQuote: "13 Consumer Price Index." },
  { row: 14, basePage: 54, amendmentPage: 6, baseQuote: "14 Industrial product price indices.", amendmentQuote: "14 Industrial product price indices." },
  { row: 15, basePage: 54, amendmentPage: 6, baseQuote: "15 Unit labour cost inflation.", amendmentQuote: "15 Unit labour cost inflation." },
  { row: 16, basePage: 54, amendmentPage: 6, baseQuote: "16 International and inter-provincial/territorial migration.", amendmentQuote: "16 International and inter-provincial/territorial migration." },
  { row: 17, basePage: 54, amendmentPage: 6, baseQuote: "17 Total commercial floor space.", amendmentQuote: "17 Total commercial floor space." },
  { row: 18, basePage: 54, amendmentPage: 6, baseQuote: "18 Household expenditures.", amendmentQuote: "18 Household expenditures." },
  { row: 19, basePage: 54, amendmentPage: 6, baseQuote: "19 Real disposable income.", amendmentQuote: "19 Real disposable income." },
  { row: 20, basePage: 54, amendmentPage: 7, baseQuote: "20 Housing starts by type.", amendmentQuote: "20 Housing starts by type." },
  { row: 21, basePage: 55, amendmentPage: 7, baseQuote: "21 Assumptions on major infrastructure projects", amendmentQuote: "21 Assumptions on major infrastructure projects" },
  { row: 22, basePage: 55, amendmentPage: 7, baseQuote: "22 Real gross output for all of the following economic sectors", amendmentQuote: "22 Real gross output for all of the following economic sectors" },
  { row: 23, basePage: 55, amendmentPage: 7, baseQuote: "23 Commercial floor space (in millions of square metres)", amendmentQuote: "23 Commercial floor space (in millions of square metres)" },
  { row: 24, basePage: 55, amendmentPage: 7, baseQuote: "24 Residential household counts and residential floor space", amendmentQuote: "24 Residential household counts and residential floor space" },
  { row: 25, basePage: 55, amendmentPage: 7, baseQuote: "25 Provide sufficient macroeconomic detail to illustrate the impact", amendmentQuote: "25 Provide sufficient macroeconomic detail to illustrate the impact" },
  { row: 26, basePage: 55, amendmentPage: 8, baseQuote: "26 Work closely with the CER on efficient data exchanges", amendmentQuote: "26 Work closely with the CER on efficient data exchanges" },
  { row: 27, basePage: 56, amendmentPage: 8, baseQuote: "27 Reflect the responsiveness of key U.S. and international drivers", amendmentQuote: "27 Reflect the responsiveness of key U.S. and international drivers" },
  { row: 28, basePage: 56, amendmentPage: 8, baseQuote: "28 Provide complete datasets for the projection and history", amendmentQuote: "28 Provide complete datasets for the projection and history" },
  { row: 29, basePage: 56, amendmentPage: 8, baseQuote: "29 Commitment to consider revising the projections", amendmentQuote: "29 Commitment to consider revising the projections" },
  { row: 30, basePage: 56, amendmentPage: 8, baseQuote: "30 Provide all essential data requirements above (Parts A - E)", amendmentQuote: "30 Provide all essential data requirements above (Parts A - E)" },
  { row: 31, basePage: 56, amendmentPage: 8, baseQuote: "31 Incorporate the required assumption changes", amendmentQuote: "31 Incorporate the required assumption changes" },
  { row: 32, basePage: 56, amendmentPage: 8, baseQuote: "32 Deliver a PowerPoint deck and brief presentation of projection", amendmentQuote: "32 Deliver a PowerPoint deck and brief presentation of projection" },
  { row: 33, basePage: 56, amendmentPage: 8, baseQuote: "33 Deliver a PowerPoint deck and brief presentation of projection", amendmentQuote: "33 Deliver a PowerPoint deck and brief presentation of projection" },
  { row: 34, basePage: 56, amendmentPage: 8, baseQuote: "34 PowerPoint decks address the required content", amendmentQuote: "34 PowerPoint decks address the required content" },
  { row: 35, basePage: 56, amendmentPage: 8, baseQuote: "35 Deliver all essential data time series for history and projections", amendmentQuote: "35 Deliver all essential data time series for history and projections" },
  { row: 36, basePage: 56, amendmentPage: 9, baseQuote: "36 Meet the estimated turnaround times once CER inputs are provided", amendmentQuote: "36 Meet the estimated turnaround times once CER inputs are provided" },
  { row: 37, basePage: 57, amendmentPage: 9, baseQuote: "37 Deliver the full scope of services and deliverables in each contract year", amendmentQuote: "37 Deliver the full scope of services and deliverables in each contract year" }
]);

export const cerM3VersionedFacts: VersionedFact[] = CER_M3_ROW_DEFINITIONS.flatMap((definition) => [
  {
    id: `m3-row-${String(definition.row).padStart(2, "0")}-base`,
    topic: `M3 Appendix 1 row ${definition.row}`,
    factKey: `document:m3-appendix-1:row:${String(definition.row).padStart(2, "0")}`,
    factKeySource: "fixture" as const,
    value: definition.baseQuote,
    documentSha256: CER_DOCUMENTS[0].sha256,
    documentRole: "base" as const,
    amendmentNumber: null,
    effect: "add" as const,
    citations: [citation(0, definition.basePage, definition.baseQuote, `Appendix 1 row ${definition.row}`)]
  },
  {
    id: `m3-row-${String(definition.row).padStart(2, "0")}-amendment-003`,
    topic: `M3 Appendix 1 row ${definition.row}`,
    factKey: `document:m3-appendix-1:row:${String(definition.row).padStart(2, "0")}`,
    factKeySource: "fixture" as const,
    value: definition.amendmentQuote,
    documentSha256: CER_DOCUMENTS[3].sha256,
    documentRole: "amendment" as const,
    amendmentNumber: "003",
    effect: "replace" as const,
    citations: [citation(3, definition.amendmentPage, definition.amendmentQuote, `Appendix 1 row ${definition.row}`)]
  }
]);

export const cerGoldenFacts: VersionedFact[] = [
  {
    id: "closing-date-base",
    topic: "Solicitation closing timestamp",
    value: "2026-09-03T14:00:00-06:00",
    documentSha256: CER_DOCUMENTS[0].sha256,
    documentRole: "base",
    amendmentNumber: null,
    effect: "add",
    citations: [citation(0, 1, "Solicitation Closes: At: 2:00 PM On: 2026-09-03 Time Zone: Mountain Daylight Time (MDT)", "Solicitation Closes")]
  },
  {
    id: "closing-date-amendment-002",
    topic: "Solicitation closing timestamp",
    value: "2026-09-15T14:00:00-06:00",
    documentSha256: CER_DOCUMENTS[2].sha256,
    documentRole: "amendment",
    amendmentNumber: "002",
    effect: "replace",
    citations: [
      citation(2, 1, "Solicitation Closes: At: 2:00 pm On: 2026-09-15 Time Zone: Mountain Daylight Time (MDT)", "Solicitation Closes"),
      citation(2, 2, "is extended from September 3, 2026, until September 15, 2026", "A. Solicitation Closing Date")
    ]
  },
  {
    id: "basis-of-payment-base",
    topic: "Controlling Basis of Payment",
    factKey: "document:basis-of-payment",
    factKeySource: "fixture",
    value: "Original RFP Annex Basis of Payment",
    documentSha256: CER_DOCUMENTS[0].sha256,
    documentRole: "base",
    amendmentNumber: null,
    effect: "add",
    citations: [citation(0, 46, "Instructions to Offerors : The financial evaluation will be conducted using the pricing tables for the Required Deliverables", "Annex Basis of Payment")]
  },
  {
    id: "basis-of-payment-amendment-001",
    topic: "Controlling Basis of Payment",
    factKey: "document:basis-of-payment",
    factKeySource: "fixture",
    value: "Amendment 001 Annex Basis of Payment (entire replacement)",
    documentSha256: CER_DOCUMENTS[1].sha256,
    documentRole: "amendment",
    amendmentNumber: "001",
    effect: "replace",
    citations: [
      citation(1, 2, "Delete: Annex Basis of Payment , in its entirety Replace With: See attached", "B. Basis of Payment Revisions"),
      citation(1, 4, "Instructions to Offerors : The financial evaluation will be conducted using the pricing tables for the Required Deliverables", "Annex Basis of Payment")
    ]
  },
  {
    id: "m3-table-base",
    topic: "Controlling M3 Appendix 1 table",
    factKey: "document:m3-appendix-1",
    factKeySource: "fixture",
    value: "Original 37-row Appendix 1 table",
    documentSha256: CER_DOCUMENTS[0].sha256,
    documentRole: "base",
    amendmentNumber: null,
    effect: "add",
    citations: [citation(0, 54, "Appendix 1 - Essential Requirements Compliance Table (Criterion M3) Instructions to Offerors", "Appendix 1")]
  },
  {
    id: "m3-table-amendment-003",
    topic: "Controlling M3 Appendix 1 table",
    factKey: "document:m3-appendix-1",
    factKeySource: "fixture",
    value: "Amendment 003 replacement 37-row Appendix 1 table",
    documentSha256: CER_DOCUMENTS[3].sha256,
    documentRole: "amendment",
    amendmentNumber: "003",
    effect: "replace",
    citations: [citation(3, 5, "is deleted in its entirety and replaced with the Appendix 1 - Essential Requirements Compliance Table (Criterion M3) included herein", "C. Tender Package / Solicitation Revisions")]
  },
  {
    id: "forecast-horizon-base",
    topic: "Original Statement of Work projection-horizon clause",
    factKey: "projection:horizon",
    factKeySource: "fixture",
    value: "Roughly 20 to 30 years from the current year",
    documentSha256: CER_DOCUMENTS[0].sha256,
    documentRole: "base",
    amendmentNumber: null,
    effect: "add",
    citations: [citation(0, 40, "Projections roughly 20 to 30 years out from the current year - on an annual basis", "3.1.1(iii)")]
  },
  {
    id: "forecast-horizon-base-deletion",
    topic: "Original Statement of Work projection-horizon clause",
    factKey: "projection:horizon",
    factKeySource: "fixture",
    value: "Deleted by Amendment 003",
    documentSha256: CER_DOCUMENTS[3].sha256,
    documentRole: "amendment",
    amendmentNumber: "003",
    effect: "delete",
    citations: [citation(3, 5, "In: Annex Statement of Work, Section 3.1.1 Essential data requirements Delete: Subsection iii.", "C. Tender Package / Solicitation Revisions")]
  },
  {
    id: "forecast-horizon-003-answer",
    topic: "Current required annual projection end year for the first contract period",
    factKey: "projection:horizon",
    factKeySource: "fixture",
    value: "2050",
    documentSha256: CER_DOCUMENTS[3].sha256,
    documentRole: "amendment",
    amendmentNumber: "003",
    effect: "replace",
    citations: [citation(3, 2, "The CER requires the initial annual basis projections to extend to 2050 for the first contract year", "A3")]
  },
  {
    id: "forecast-horizon-003-sow",
    topic: "Current required annual projection end year for the first contract period",
    factKey: "projection:horizon",
    factKeySource: "fixture",
    value: "2055",
    documentSha256: CER_DOCUMENTS[3].sha256,
    documentRole: "amendment",
    amendmentNumber: "003",
    effect: "replace",
    citations: [citation(3, 5, "Annual basis projections to 2055 out from the current year for the first contract period.", "Replacement 3.1.1(iii)")]
  },
  {
    id: "forecast-horizon-003-table",
    topic: "Current required annual projection end year for the first contract period",
    factKey: "projection:horizon",
    factKeySource: "fixture",
    value: "2050",
    documentSha256: CER_DOCUMENTS[3].sha256,
    documentRole: "amendment",
    amendmentNumber: "003",
    effect: "replace",
    citations: [citation(3, 6, "3 Annual basis projections to 2050 for the first contract period.", "Appendix 1 row 3")]
  },
  ...cerM3VersionedFacts
];

export const cerEvaluationGolden = Object.freeze({
  mandatoryGate: Object.freeze({
    value: true,
    citations: [citation(0, 9, "Canada will declare any offer that fails to meet all mandatory solicitation requirements non-compliant.", "10.1")]
  }),
  ratedThreshold: Object.freeze({
    minimum: 50,
    maximum: 94,
    display: "50/94",
    citations: [
      citation(0, 11, "obtain the required minimum of fifty (50) points overall for the technical evaluation criteria which are subject to point rating. The rating is performed on a scale of ninety-four (94) points.", "11.1(a)(iii)"),
      citation(0, 52, "offerors must achieve a minimum Technical Rating of 50 points out of the 94 points available", "3.0 Evaluation and Rating")
    ]
  }),
  technicalWeight: Object.freeze({
    value: 70,
    citations: [citation(0, 11, "The ratio will be 70% for the technical merit and 30% for the price.", "11.1(c)")]
  }),
  financialWeight: Object.freeze({
    value: 30,
    citations: [citation(0, 11, "The ratio will be 70% for the technical merit and 30% for the price.", "11.1(c)")]
  }),
  selectionMethod: Object.freeze({
    value: "Highest combined rating of technical merit and price",
    citations: [citation(0, 11, "Canada will make its selection based on the compliant offer with the highest combined rating of technical merit and price for award.", "11.1(c)")]
  })
});
