import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Citation } from "@/contracts";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import { recoverSecurityRequirementAnchors } from "@/lib/analysis/source-anchors";
import { verifyCitation, type CitationDocument } from "@/lib/evidence/citations";
import {
  CER_DOCUMENTS,
  CER_M3_ROW_DEFINITIONS,
  cerEvaluationGolden,
  cerGoldenFacts
} from "@/lib/fixtures/cer";
import {
  createEdmontonSampleResult,
  EDMONTON_ACROFORM_UNIQUE_FIELDS,
  EDMONTON_FORM_WIDGETS_BY_PAGE,
  EDMONTON_PAGES,
  EDMONTON_PRICING_BLANK_AMOUNTS,
  EDMONTON_SHA256,
  EDMONTON_SOURCE_URL,
  EDMONTON_WIDGETS
} from "@/lib/fixtures/edmonton";
import { buildPdfPageIndex, normalizeEvidenceText, type PdfPageIndex } from "@/lib/pdf/page-index";

const fixtureDirectory = process.env.RFP_XRAY_FIXTURE_DIR;
const auditIt = fixtureDirectory ? it : it.skip;

function allEdmontonCitations(): Citation[] {
  const result = createEdmontonSampleResult();
  return [
    ...result.claims.flatMap((item) => item.citations),
    ...result.requirements.flatMap((item) => item.citations),
    ...result.evaluation.citations,
    ...result.risks.flatMap((item) => item.citations),
    ...result.conflicts.flatMap((item) => item.citations)
  ];
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

function allCerCitations(): Citation[] {
  return [
    ...cerGoldenFacts.flatMap((fact) => fact.citations),
    ...cerEvaluationGolden.mandatoryGate.citations,
    ...cerEvaluationGolden.ratedThreshold.citations,
    ...cerEvaluationGolden.technicalWeight.citations,
    ...cerEvaluationGolden.financialWeight.citations,
    ...cerEvaluationGolden.selectionMethod.citations
  ];
}

function assertFrozenCitationsAgainstVerifier(citations: Citation[], documents: CitationDocument[]) {
  for (const frozen of citations) {
    expect(frozen.verified).toBe(true);
    const actual = verifyCitation({
      documentSha256: frozen.document_sha256,
      evidenceQuote: frozen.evidence_quote,
      section: frozen.section
    }, documents, new Date("2026-09-02T00:00:00.000Z")).citation;
    expect(actual, `${frozen.document_name}: ${frozen.evidence_quote}`).toMatchObject({
      document_sha256: frozen.document_sha256,
      pdf_page_1based: frozen.pdf_page_1based,
      verified: true
    });
  }
}

describe("optional official-PDF local audit (PDFs are never committed)", () => {
  auditIt("verifies every frozen Edmonton citation plus page, criteria, security, and blank-price facts", async () => {
    const bytes = new Uint8Array(await readFile(path.join(fixtureDirectory!, "edmonton.pdf")));
    const index = await buildPdfPageIndex(bytes);
    expect(index.documentSha256).toBe(EDMONTON_SHA256);
    expect(index.pagesTotal).toBe(EDMONTON_PAGES);

    expect(index.pages[46].normalizedText).toContain("page 47 of 47");
    expect(index.pages[47].normalizedText).toContain("page 1/8");
    expect(index.pages[54].normalizedText).toContain("page 8/8");

    const mandatoryIds = [...new Set(index.pages[42].normalizedText.match(/\bm\d+\b/g) ?? [])];
    expect(mandatoryIds).toEqual(["m1", "m2", "m3", "m4"]);
    expect(index.pages[42].normalizedText).toContain("up to three (3) resources");
    expect(index.pages[13].normalizedText).toContain("meet all mandatory technical evaluation criteria");
    expect(index.pages[13].normalizedText).toContain("lowest evaluated price");
    expect(index.pages[13].normalizedText).not.toContain("70% for the technical merit");

    expect(index.pages[14].normalizedText).toContain("application for registration (afr)");
    expect(index.pages[15].normalizedText).toContain("valid organization security clearance");
    expect(index.pages[16].normalizedText).toContain("designated organization screening (dos)");
    expect(index.pages[16].normalizedText).toContain("each hold a valid reliability status");
    expect(index.pages[16].normalizedText).toContain("attached at annex d");
    expect(index.pages[42].normalizedText).toContain(normalizeEvidenceText("ANNEX “ E ” - SECURITY REQUIREMENTS CHECK LIST"));

    const recoveredSecurity = recoverSecurityRequirementAnchors(emptyDraft(), [{
      name: "edmonton-100022184-A.pdf",
      sourceUrl: EDMONTON_SOURCE_URL,
      index,
      role: "base",
      amendmentNumber: null
    }]);
    expect(recoveredSecurity).toHaveLength(4);
    expect(recoveredSecurity.map((requirement) => requirement.citations[0].section))
      .toEqual(["5.2.2", "6.1", "7.3.1", "7.3.1"]);
    expect(new Set(recoveredSecurity.flatMap((requirement) =>
      requirement.citations.map((citation) => citation.evidence_quote)
    )).size).toBe(4);

    const blankCounts = Object.fromEntries(
      [40, 41, 42].map((page) => [page, index.pages[page - 1].text.match(/\$_{7,}/g)?.length ?? 0])
    );
    expect(blankCounts).toEqual({ 40: 14, 41: 10, 42: 12 });
    expect(EDMONTON_PRICING_BLANK_AMOUNTS).toHaveLength(Object.values(blankCounts).reduce((sum, count) => sum + count, 0));
    expect(EDMONTON_PRICING_BLANK_AMOUNTS.every((item) => item.value === null && item.status === "unknown")).toBe(true);

    assertFrozenCitationsAgainstVerifier(allEdmontonCitations(), [{
      name: "edmonton-100022184-A.pdf",
      sourceUrl: EDMONTON_SOURCE_URL,
      index
    }]);
  }, 30_000);

  auditIt("counts Edmonton's canonical field names and widgets through PDF.js annotation APIs", async () => {
    const bytes = new Uint8Array(await readFile(path.join(fixtureDirectory!, "edmonton.pdf")));
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true });
    try {
      const document = await loadingTask.promise;
      const fieldNames: string[] = [];
      const widgetsByPage: Record<number, number> = {};
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const annotations = await page.getAnnotations();
        const widgets = annotations.filter((annotation) => annotation.subtype === "Widget");
        if (widgets.length > 0) widgetsByPage[pageNumber] = widgets.length;
        for (const widget of widgets) {
          if (typeof widget.fieldName === "string") fieldNames.push(widget.fieldName);
        }
        page.cleanup();
      }
      expect(widgetsByPage).toEqual(EDMONTON_FORM_WIDGETS_BY_PAGE);
      expect(fieldNames).toHaveLength(EDMONTON_WIDGETS);
      expect(new Set(fieldNames).size).toBe(EDMONTON_ACROFORM_UNIQUE_FIELDS);
      expect(Object.keys(widgetsByPage).map(Number)).toEqual([48, 49, 50, 51, 52, 53, 54, 55]);
    } finally {
      await loadingTask.destroy();
    }
  }, 30_000);

  auditIt("verifies every CER frozen quote/page and all package-level physical facts", async () => {
    const documents: CitationDocument[] = [];
    const indexes = new Map<string, PdfPageIndex>();
    for (const document of CER_DOCUMENTS) {
      const bytes = new Uint8Array(await readFile(path.join(fixtureDirectory!, document.name)));
      const index = await buildPdfPageIndex(bytes);
      expect(index.documentSha256).toBe(document.sha256);
      expect(index.pagesTotal).toBe(document.pages);
      indexes.set(document.sha256, index);
      documents.push({ name: document.name, sourceUrl: document.url, index });
    }

    const base = indexes.get(CER_DOCUMENTS[0].sha256)!;
    const amendment001 = indexes.get(CER_DOCUMENTS[1].sha256)!;
    const amendment002 = indexes.get(CER_DOCUMENTS[2].sha256)!;
    const amendment003 = indexes.get(CER_DOCUMENTS[3].sha256)!;

    expect(base.pages[8].normalizedText).toContain("fails to meet all mandatory solicitation requirements non-compliant");
    expect(base.pages[10].normalizedText).toContain("minimum of fifty (50) points");
    expect(base.pages[10].normalizedText).toContain("scale of ninety-four (94) points");
    expect(base.pages[10].normalizedText).toContain("70% for the technical merit and 30% for the price");
    expect(base.pages[10].normalizedText).toContain("highest combined rating of technical merit and price");

    expect(amendment001.pages[1].normalizedText).toContain("delete: annex basis of payment , in its entirety");
    expect(amendment001.pages[1].normalizedText).toContain("cancels and supersedes the previous annex basis of payment");
    expect(amendment001.pages[3].normalizedText).toContain("annex basis of payment");

    expect(amendment002.pages[0].normalizedText).toContain("at: 2:00 pm");
    expect(amendment002.pages[0].normalizedText).toContain("on: 2026-09-15");
    expect(amendment002.pages[0].normalizedText).toContain("mountain daylight time (mdt)");
    expect(amendment002.pages[1].normalizedText).toContain("extended from september 3, 2026, until september 15, 2026");

    expect(amendment003.pages[1].normalizedText).toContain("extend to 2050 for the first contract year");
    expect(amendment003.pages[4].normalizedText).toContain("annual basis projections to 2055");
    expect(amendment003.pages[5].normalizedText).toContain("annual basis projections to 2050");
    expect(amendment003.pages[4].normalizedText).toContain("deleted in its entirety and replaced");

    expect(CER_M3_ROW_DEFINITIONS).toHaveLength(37);
    for (const definition of CER_M3_ROW_DEFINITIONS) {
      expect(
        base.pages[definition.basePage - 1].normalizedText,
        `base M3 row ${definition.row} on p${definition.basePage}`
      ).toContain(normalizeEvidenceText(definition.baseQuote));
      expect(
        amendment003.pages[definition.amendmentPage - 1].normalizedText,
        `amendment 003 M3 row ${definition.row} on p${definition.amendmentPage}`
      ).toContain(normalizeEvidenceText(definition.amendmentQuote));
    }

    assertFrozenCitationsAgainstVerifier(allCerCitations(), documents);
  }, 60_000);
});
