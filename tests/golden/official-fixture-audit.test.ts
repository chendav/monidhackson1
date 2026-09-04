import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Citation } from "@/contracts";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import { materializeAnalysis } from "@/lib/analysis/materialize";
import {
  MAX_RECORD_AUTHORITY_RECEIPT_BYTES,
  verifyRecordAuthorities
} from "@/lib/analysis/record-authority";
import {
  recoverBasisOfSelectionEvaluationAnchors,
  recoverSecurityRequirementAnchors,
  recoverSubmissionMethodAnchors,
  recoverStrictCoverAnchors
} from "@/lib/analysis/source-anchors";
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
import { discoverSubmissionCandidateLedger } from "@/lib/analysis/submission-channel";
import { getConfig } from "@/lib/config";
import {
  mergeDrafts,
  prepareExtractionPlan,
  privateExtractionFormatForBatch
} from "@/lib/providers/openai";
import { verifiedFixtureSubmissionAdjudication } from "../helpers/submission-adjudication";

const fixtureDirectory = process.env.RFP_XRAY_FIXTURE_DIR;
const auditIt = fixtureDirectory ? it : it.skip;

function modelPlanConfig() {
  return getConfig({
    NODE_ENV: "test",
    OPENAI_API_KEY: "test-key",
    SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough"
  });
}

function dynamicFormatMeasurements(plan: ReturnType<typeof prepareExtractionPlan>) {
  return plan.bindings.map((binding) => {
    const candidates = binding.ordered_candidate_ids.map((id) =>
      plan.ledger.candidates.find((candidate) => candidate.candidate_id === id)!
    );
    const format = privateExtractionFormatForBatch(binding, candidates) as unknown as {
      schema: { properties: { submission_adjudication: { properties: {
        b: { const: string }; l: { const: string }; r: {
          required: string[]; additionalProperties: false
        }
      } } } };
    };
    expect(format.schema.properties.submission_adjudication.properties.b.const).toBe(binding.batch_id);
    expect(format.schema.properties.submission_adjudication.properties.l.const).toBe(binding.ledger_digest);
    expect(format.schema.properties.submission_adjudication.properties.r.required)
      .toEqual(binding.ordered_candidate_ids);
    expect(format.schema.properties.submission_adjudication.properties.r.additionalProperties).toBe(false);
    return new TextEncoder().encode(JSON.stringify(format)).byteLength;
  });
}

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

function emptyDraft(records: Partial<DraftAnalysis> = {}): DraftAnalysis {
  return {
    summary: {
      title: "", solicitation_number: null, issuer: null, closing_date: null,
      overview: "", scope: [], submission_method: null, current_selection_method: null
    },
    claims: [], requirements: [], evaluation: { rules: [] }, risks: [],
    clarification_questions: [], blocking_unknowns: [], ...records
  };
}

function representativeRequirement(options: {
  id: string;
  topic: string;
  category: DraftAnalysis["requirements"][number]["category"];
  quote: string;
  documentSha256: string;
  amendmentNumber: string | null;
}) {
  return {
    id: options.id,
    topic: options.topic,
    category: options.category,
    text: options.quote,
    evidence_needed: null,
    consequence: null,
    document_sha256: options.documentSha256,
    amendment_number: options.amendmentNumber,
    effect: "add" as const,
    citations: [{
      document_sha256: options.documentSha256,
      chunk_id: null,
      evidence_quote: options.quote,
      section: null
    }]
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

    const sourceDocument = {
      name: "edmonton-100022184-A.pdf",
      sourceUrl: EDMONTON_SOURCE_URL,
      index,
      role: "base" as const,
      amendmentNumber: null
    };
    const recoveredCover = recoverStrictCoverAnchors(emptyDraft(), [sourceDocument]);
    expect(Object.fromEntries(recoveredCover.map((claim) => [claim.topic, claim.claim_text])))
      .toEqual({
        "solicitation title": "Repair & Maintenance on various File Bays",
        "solicitation number": "100022184-A",
        issuer: "Employment and Social Development Canada"
      });
    expect(recoveredCover.every((claim) => claim.citations[0].evidence_quote.length <= 500))
      .toBe(true);

    const recoveredSubmission = recoverSubmissionMethodAnchors(emptyDraft(), [sourceDocument]);
    expect(recoveredSubmission).toEqual([]);

    const submissionClause = "send its bid only to the e-mail address specified on Page 1;";
    const submissionLedger = discoverSubmissionCandidateLedger([sourceDocument]);
    expect(submissionLedger.candidates).toHaveLength(81);
    expect(submissionLedger.ledger_digest)
      .toBe("4c1d63de591108e88f9c55dec04b8c1e3449cd8337e4d358add4164e762b1734");
    expect(submissionLedger.capacity_exceeded).toBe(false);
    const submissionAdjudication = verifiedFixtureSubmissionAdjudication(
      [sourceDocument],
      (candidate) => candidate.pdf_page_1based === 6 &&
        candidate.source_window.includes(submissionClause) &&
        candidate.occurrences.some((occurrence) => occurrence.channel_hint === "email")
        ? [{
            evidenceText: submissionClause,
            subjectScope: "whole_bid",
            modality: "required",
            channel: "email"
          }]
        : undefined,
      { defaultOccurrenceDisposition: "other" }
    );
    expect(submissionAdjudication).toMatchObject({
      complete: true,
      expected_candidate_count: 81,
      verified_candidate_count: 81,
      unresolved_reasons: []
    });
    const extractionPlan = prepareExtractionPlan([{
      document_sha256: EDMONTON_SHA256,
      document_name: sourceDocument.name,
      role: "base",
      amendment_number: null,
      parsed_markdown: index.pages.map((page) => page.text).join("\n"),
      evidence_chunks: index.chunks,
      submission_ledger: submissionLedger
    }], modelPlanConfig());
    expect(extractionPlan.packingComplete).toBe(true);
    expect(extractionPlan.inputs).toHaveLength(3);
    expect(extractionPlan.inputs.every((input) =>
      new TextEncoder().encode(input).byteLength <= 140_000
    )).toBe(true);
    expect(extractionPlan.bindings.flatMap((binding) => binding.ordered_candidate_ids).toSorted())
      .toEqual(submissionLedger.candidates.map((candidate) => candidate.candidate_id).toSorted());
    expect(extractionPlan.controlPlaneOutputUpperBoundBytes).toEqual([4772, 5339, 5696]);
    expect(extractionPlan.controlPlaneOutputUpperBoundBytes.reduce((sum, bytes) => sum + bytes, 0))
      .toBe(15_807);
    expect(extractionPlan.controlPlaneOutputPreflightInputs.every((item) =>
      (JSON.parse(item) as { submission_adjudication: { v: number } }).submission_adjudication.v === 2 &&
      !("record_authority" in JSON.parse(item))
    )).toBe(true);
    expect(Math.min(...extractionPlan.controlPlaneOutputUpperBoundBytes.map((bytes) =>
      Math.floor(50_000 / extractionPlan.inputs.length) - bytes
    ))).toBe(10_970);
    expect(50_000 - extractionPlan.controlPlaneOutputUpperBoundBytes.reduce((sum, bytes) => sum + bytes, 0))
      .toBe(34_193);
    expect(dynamicFormatMeasurements(extractionPlan)).toEqual([29_389, 32_029, 32_029]);
    const emptyAuthorityReceipt = verifyRecordAuthorities({
      batches: extractionPlan.bindings.map((binding) => ({
        binding,
        draft: emptyDraft(),
        authority: { v: 1, r: [] }
      })),
      ledger: submissionLedger,
      submission: submissionAdjudication,
      documents: [sourceDocument],
      mergedDraft: emptyDraft()
    });
    expect(emptyAuthorityReceipt).toMatchObject({ complete: true, package_veto: false });
    expect(emptyAuthorityReceipt.receipt_byte_length).toBe(166);
    expect(MAX_RECORD_AUTHORITY_RECEIPT_BYTES - emptyAuthorityReceipt.receipt_byte_length)
      .toBe(261_978);
    const representativeDrafts: DraftAnalysis[] = [
      emptyDraft({ claims: [{
        claim_id: "representative-email",
        topic: "whole-bid submission method",
        claim_text: submissionClause,
        claim_type: "source",
        confidence: 1,
        document_sha256: EDMONTON_SHA256,
        amendment_number: null,
        effect: "add",
        citations: [{
          document_sha256: EDMONTON_SHA256,
          chunk_id: null,
          evidence_quote: submissionClause,
          section: "2.1.4"
        }],
        supersedes_claim_ids: []
      }] }),
      emptyDraft({ requirements: [representativeRequirement({
        id: "representative-selection",
        topic: "basis of selection",
        category: "financial",
        quote: "The responsive bid with the lowest evaluated price will be recommended for award of\na contract.",
        documentSha256: EDMONTON_SHA256,
        amendmentNumber: null
      })] }),
      emptyDraft({ requirements: [representativeRequirement({
        id: "representative-security",
        topic: "contract security",
        category: "security",
        quote: "The Contractor must, at all times during the performance of the Contract, hold a valid Designated Organization\nScreening (DOS)",
        documentSha256: EDMONTON_SHA256,
        amendmentNumber: null
      })] })
    ];
    const representativeReceipt = verifyRecordAuthorities({
      batches: extractionPlan.bindings.map((binding, index) => ({
        binding,
        draft: representativeDrafts[index]!,
        authority: { v: 1, r: [[index === 0 ? "c" : "q", 0, index === 0 ? "s" : "n"]] }
      })),
      ledger: submissionLedger,
      submission: submissionAdjudication,
      documents: [sourceDocument],
      mergedDraft: mergeDrafts(representativeDrafts)
    });
    expect(representativeReceipt).toMatchObject({ complete: true, package_veto: false });
    expect(representativeReceipt.receipt_byte_length).toBe(4_225);
    expect(MAX_RECORD_AUTHORITY_RECEIPT_BYTES - representativeReceipt.receipt_byte_length)
      .toBe(257_919);

    const recoveredEvaluation = recoverBasisOfSelectionEvaluationAnchors(
      emptyDraft(),
      [sourceDocument]
    );
    expect(recoveredEvaluation.map((rule) => ({ field: rule.field, value: rule.value })))
      .toEqual([
        { field: "mandatory_gate", value: "true" },
        { field: "selection_method", value: "Lowest evaluated price" }
      ]);
    expect(recoveredEvaluation.every((rule) =>
      rule.citations[0].evidence_quote.length <= 500 &&
      !/70%|30%|combined rating/i.test(rule.citations[0].evidence_quote)
    )).toBe(true);

    const materialized = materializeAnalysis({
      draft: emptyDraft(),
      submissionAdjudication,
      documents: [sourceDocument],
      manifests: [{
        document_id: crypto.randomUUID(),
        role: "base",
        source_type: "url",
        source_name: sourceDocument.name,
        source_url: EDMONTON_SOURCE_URL,
        sha256: EDMONTON_SHA256,
        pages: EDMONTON_PAGES,
        language: "en",
        solicitation_number: "100022184-A",
        amendment_number: null,
        status: "active",
        cleanup_status: "deleted"
      }],
      costs: [],
      generatedAt: new Date("2026-09-03T00:00:00.000Z"),
      expiresAt: new Date("2026-09-04T00:00:00.000Z")
    }).result;
    expect(materialized.summary).toMatchObject({
      title: "Repair & Maintenance on various File Bays",
      solicitation_number: "100022184-A",
      issuer: "Employment and Social Development Canada",
      submission_method: "Email",
      current_selection_method: "Lowest evaluated price"
    });
    expect(materialized.evaluation).toMatchObject({
      mandatory_gate: true,
      rated_threshold: null,
      technical_weight: null,
      financial_weight: null,
      selection_method: "Lowest evaluated price"
    });
    expect(materialized.evaluation.citations.map((citation) => citation.pdf_page_1based))
      .toEqual([14, 14]);
    expect(materialized.claims.find((claim) =>
      claim.status === "active" && claim.claim_text === "Email"
    )?.citations).toEqual([
      expect.objectContaining({ verified: true, pdf_page_1based: 6, section: "2.1.4" })
    ]);
    expect(materialized.decision_readiness).toBe("needs_clarification");

    const recoveredSecurity = recoverSecurityRequirementAnchors(emptyDraft(), [sourceDocument]);
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

    const candidateDocuments = CER_DOCUMENTS.map((document) => ({
      name: document.name,
      sourceUrl: document.url,
      index: indexes.get(document.sha256)!,
      role: document.role,
      amendmentNumber: document.amendment
    }));
    const submissionLedger = discoverSubmissionCandidateLedger(candidateDocuments);
    expect(submissionLedger).toMatchObject({
      ledger_digest: "c617540f1566a464037e48efa2fe16043d56ea58a5cf21191db8a937afe0adc5",
      expected_page_count: 75,
      covered_page_count: 75,
      metadata_complete: true,
      capacity_exceeded: false
    });
    expect(submissionLedger.candidates).toHaveLength(107);
    const extractionPlan = prepareExtractionPlan(CER_DOCUMENTS.map((document, index) => ({
      document_sha256: document.sha256,
      document_name: document.name,
      role: document.role,
      amendment_number: document.amendment,
      parsed_markdown: indexes.get(document.sha256)!.pages.map((page) => page.text).join("\n"),
      evidence_chunks: indexes.get(document.sha256)!.chunks,
      submission_ledger: index === 0 ? submissionLedger : undefined
    })), modelPlanConfig());
    expect(extractionPlan.packingComplete).toBe(true);
    expect(extractionPlan.inputs).toHaveLength(5);
    expect(extractionPlan.inputs.every((input) =>
      new TextEncoder().encode(input).byteLength <= 140_000
    )).toBe(true);
    expect(extractionPlan.bindings.flatMap((binding) => binding.ordered_candidate_ids).toSorted())
      .toEqual(submissionLedger.candidates.map((candidate) => candidate.candidate_id).toSorted());
    expect(extractionPlan.controlPlaneOutputUpperBoundBytes).toEqual([4180, 3979, 4406, 4517, 6164]);
    expect(extractionPlan.controlPlaneOutputUpperBoundBytes.reduce((sum, bytes) => sum + bytes, 0))
      .toBe(23_246);
    expect(extractionPlan.controlPlaneOutputPreflightInputs.every((item) =>
      (JSON.parse(item) as { submission_adjudication: { v: number } }).submission_adjudication.v === 2 &&
      !("record_authority" in JSON.parse(item))
    )).toBe(true);
    expect(Math.min(...extractionPlan.controlPlaneOutputUpperBoundBytes.map((bytes) =>
      Math.floor(50_000 / extractionPlan.inputs.length) - bytes
    ))).toBe(3_836);
    expect(50_000 - extractionPlan.controlPlaneOutputUpperBoundBytes.reduce((sum, bytes) => sum + bytes, 0))
      .toBe(26_754);
    expect(dynamicFormatMeasurements(extractionPlan)).toEqual([
      25_869, 26_749, 25_869, 28_509, 24_111
    ]);
    const submissionAdjudication = verifiedFixtureSubmissionAdjudication(
      candidateDocuments,
      () => undefined,
      { defaultOccurrenceDisposition: "other" }
    );
    const emptyAuthorityReceipt = verifyRecordAuthorities({
      batches: extractionPlan.bindings.map((binding) => ({
        binding,
        draft: emptyDraft(),
        authority: { v: 1, r: [] }
      })),
      ledger: submissionLedger,
      submission: submissionAdjudication,
      documents: candidateDocuments,
      mergedDraft: emptyDraft()
    });
    expect(emptyAuthorityReceipt).toMatchObject({ complete: true, package_veto: false });
    expect(emptyAuthorityReceipt.receipt_byte_length).toBe(166);
    expect(MAX_RECORD_AUTHORITY_RECEIPT_BYTES - emptyAuthorityReceipt.receipt_byte_length)
      .toBe(261_978);
    const representativeQuotes = [
      {
        id: "representative-cer-mandatory", topic: "mandatory evaluation", category: "mandatory" as const,
        quote: "Canada will declare any offer that fails to\nmeet all mandatory solicitation requirements non-compliant.", document: CER_DOCUMENTS[0]
      },
      {
        id: "representative-cer-basis", topic: "basis replacement", category: "financial" as const,
        quote: "Annex Basis of Payment included in this solicitation amendment cancels and supersedes the\nprevious Annex Basis of Payment identified for Request for Proposal.", document: CER_DOCUMENTS[1]
      },
      {
        id: "representative-cer-revision", topic: "amendment continuity", category: "contractual" as const,
        quote: "The referenced document is hereby revised;\nunless otherwise indicated, all other terms and\nconditions remain the same.", document: CER_DOCUMENTS[2]
      },
      {
        id: "representative-cer-horizon", topic: "forecast horizon", category: "delivery" as const,
        quote: "The CER requires the initial annual basis projections to extend to 2050 for the first contract year, with\nsubsequent contract periods potentially requiring projections to extend to 2055 or 2060.", document: CER_DOCUMENTS[3]
      },
      {
        id: "representative-cer-m3", topic: "M3 compliance", category: "mandatory" as const,
        quote: "Any requirement marked \"No\" or left blank will result in the bid being declared non-responsive.", document: CER_DOCUMENTS[3]
      }
    ];
    const representativeDrafts = representativeQuotes.map((item) => emptyDraft({
      requirements: [representativeRequirement({
        id: item.id,
        topic: item.topic,
        category: item.category,
        quote: item.quote,
        documentSha256: item.document.sha256,
        amendmentNumber: item.document.amendment
      })]
    }));
    const representativeReceipt = verifyRecordAuthorities({
      batches: extractionPlan.bindings.map((binding, index) => ({
        binding,
        draft: representativeDrafts[index]!,
        authority: { v: 1, r: [["q", 0, "n"]] }
      })),
      ledger: submissionLedger,
      submission: submissionAdjudication,
      documents: candidateDocuments,
      mergedDraft: mergeDrafts(representativeDrafts)
    });
    expect(representativeReceipt).toMatchObject({ complete: true, package_veto: false });
    expect(representativeReceipt.receipt_byte_length).toBe(6_681);
    expect(MAX_RECORD_AUTHORITY_RECEIPT_BYTES - representativeReceipt.receipt_byte_length)
      .toBe(255_463);

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
