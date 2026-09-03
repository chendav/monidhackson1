import type { Citation, DocumentManifest } from "@/contracts";
import type { VersionedFact } from "@/lib/analysis/reconciliation";

export const CER_DOCUMENTS = Object.freeze([
  { name: "cer-main.pdf", sha256: "894b876fdfdacb2aec0571f4cf2f29be08ebc2380c6e3251bb48885f69d31bfb", pages: 58, role: "base" as const, amendment: null },
  { name: "cer-amendment-001.pdf", sha256: "ec135a6ddf7a22120530bef89612cfedc7f007c64cf313f2b8de46d143027cfc", pages: 6, role: "amendment" as const, amendment: "001" },
  { name: "cer-amendment-002.pdf", sha256: "300a06081b195ea28f858feb20bd6780f596ceefc638495c4fdd63a5edea352c", pages: 2, role: "amendment" as const, amendment: "002" },
  { name: "cer-amendment-003.pdf", sha256: "98f6299df44edaab9e8ec834b476d88358d5af75923646b5fb190e709be1204f", pages: 9, role: "amendment" as const, amendment: "003" }
]);

function citation(documentIndex: number, page: number, quote: string): Citation {
  const document = CER_DOCUMENTS[documentIndex];
  return {
    document_sha256: document.sha256,
    document_name: document.name,
    source_url: null,
    pdf_page_1based: page,
    printed_page_label: `${page} of ${document.pages}`,
    section: null,
    evidence_quote: quote,
    verified: true,
    verification_method: "exact"
  };
}

export const cerManifest: DocumentManifest[] = CER_DOCUMENTS.map((document, index) => ({
  document_id: `84084000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  role: document.role,
  source_type: "url",
  source_name: document.name,
  source_url: null,
  sha256: document.sha256,
  pages: document.pages,
  language: "en",
  solicitation_number: "84084-26-0009/A",
  amendment_number: document.amendment,
  status: "active",
  cleanup_status: "deleted"
}));

export const cerGoldenFacts: VersionedFact[] = [
  {
    id: "forecast-horizon-base",
    topic: "Required annual projection horizon for the first contract period",
    value: "Roughly 20 to 30 years from the current year",
    documentSha256: CER_DOCUMENTS[0].sha256,
    documentRole: "base",
    amendmentNumber: null,
    effect: "add",
    citations: [citation(0, 40, "Projections roughly 20 to 30 years out from the current year – on an annual basis")]
  },
  {
    id: "closing-date-base",
    topic: "Solicitation closing date",
    value: "2026-09-03",
    documentSha256: CER_DOCUMENTS[0].sha256,
    documentRole: "base",
    amendmentNumber: null,
    effect: "add",
    citations: [citation(0, 1, "On: 2026-09-03")]
  },
  {
    id: "closing-date-amendment-002",
    topic: "Solicitation closing date",
    value: "2026-09-15",
    documentSha256: CER_DOCUMENTS[2].sha256,
    documentRole: "amendment",
    amendmentNumber: "002",
    effect: "replace",
    citations: [citation(2, 2, "is extended from September 3, 2026, until September 15, 2026")]
  },
  {
    id: "forecast-horizon-003-answer",
    topic: "Required annual projection horizon for the first contract period",
    value: "2050",
    documentSha256: CER_DOCUMENTS[3].sha256,
    documentRole: "amendment",
    amendmentNumber: "003",
    effect: "replace",
    citations: [citation(3, 2, "The CER requires the initial annual basis projections to extend to 2050 for the first contract year")]
  },
  {
    id: "forecast-horizon-003-replacement",
    topic: "Required annual projection horizon for the first contract period",
    value: "2055",
    documentSha256: CER_DOCUMENTS[3].sha256,
    documentRole: "amendment",
    amendmentNumber: "003",
    effect: "replace",
    citations: [citation(3, 5, "Annual basis projections to 2055 out from the current year for the first contract period")]
  }
];
