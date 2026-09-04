import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Citation } from "@/contracts";
import type { DraftAnalysis } from "@/lib/analysis/draft";
import { materializeAnalysis } from "@/lib/analysis/materialize";
import { sha256Hex } from "@/lib/crypto";
import {
  MAX_RECORD_AUTHORITY_RECEIPT_BYTES,
  RECORD_AUTHORITY_ENVELOPE_VERSION,
  RECORD_SOURCE_ALIGNMENT_VERSION,
  RecordAuthorityEnvelopeSchema,
  buildDocumentSourceMap,
  resolveSemanticSpan,
  selectorsForEvidenceRepresentation,
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
  OPENAI_MIN_PAID_BATCH_WINDOW_MS,
  mergeDrafts,
  prepareExtractionPlan,
  privateExtractionFormatForBatch,
  protectedOutputTokenCap
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

function boundAuthority(
  draft: DraftAnalysis,
  annotations: Array<["c" | "q" | "r" | "e", number, "s" | "n" | "u"]>,
  binding: ReturnType<typeof prepareExtractionPlan>["bindings"][number],
  sourceMap: ReturnType<typeof prepareExtractionPlan>["sourceMaps"][number],
  documents: CitationDocument[]
) {
  const records = [
    ...draft.claims.map((record, ordinal) => ({ kind: "c" as const, ordinal, record })),
    ...draft.requirements.map((record, ordinal) => ({ kind: "q" as const, ordinal, record })),
    ...draft.risks.map((record, ordinal) => ({ kind: "r" as const, ordinal, record })),
    ...draft.evaluation.rules.map((record, ordinal) => ({ kind: "e" as const, ordinal, record }))
  ];
  return RecordAuthorityEnvelopeSchema.parse({
    v: RECORD_AUTHORITY_ENVELOPE_VERSION,
    r: annotations.map(([kind, ordinal, relevance]) => {
      const record = records.find((item) => item.kind === kind && item.ordinal === ordinal)?.record;
      const physical = (record?.citations ?? []).flatMap((citation, citationOrdinal) => {
        const document = documents.find((item) =>
          item.index.documentSha256 === citation.document_sha256
        );
        const selectors = document?.index.pages.flatMap((page) =>
          selectorsForEvidenceRepresentation(sourceMap, {
            document_sha256: citation.document_sha256,
            pdf_page_1based: page.pdfPage1Based,
            evidence_quote: citation.evidence_quote
          }, documents)
        ) ?? [];
        const resolved = selectors.length > 0
          ? resolveSemanticSpan(sourceMap, selectors[0]!, documents)
          : null;
        return resolved?.evidence_quote === citation.evidence_quote
          ? [{ citation_ordinal: citationOrdinal, ...resolved.binding }]
          : [];
      });
      return [kind, ordinal, relevance, physical];
    })
  });
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
    expect(submissionLedger.candidates).toHaveLength(85);
    expect(submissionLedger.ledger_digest)
      .toBe("be01d291ef121a984f9d6074d3d7d999b85bf131629cd49075a570a0d8f4ad71");
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
      expected_candidate_count: 85,
      verified_candidate_count: 85,
      unresolved_reasons: []
    });
    const extractionPlan = prepareExtractionPlan([{
      document_sha256: EDMONTON_SHA256,
      document_name: sourceDocument.name,
      role: "base",
      amendment_number: null,
      parsed_markdown: index.pages.map((page) => page.text).join("\n"),
      evidence_chunks: index.chunks,
      submission_ledger: submissionLedger,
      citation_document: sourceDocument
    }], modelPlanConfig());
    expect(extractionPlan.packingComplete).toBe(true);
    expect(extractionPlan.inputs.map((input) => new TextEncoder().encode(input).byteLength))
      .toEqual([94_849, 95_663, 94_127, 93_341]);
    expect(extractionPlan.inputs.every((input) =>
      new TextEncoder().encode(input).byteLength < 140_000
    )).toBe(true);
    expect(extractionPlan.bindings.map((binding) => binding.ordered_candidate_ids.length))
      .toEqual([24, 20, 22, 19]);
    expect(extractionPlan.bindings.flatMap((binding) => binding.ordered_candidate_ids).toSorted())
      .toEqual(submissionLedger.candidates.map((candidate) => candidate.candidate_id).toSorted());
    expect(extractionPlan.controlPlaneOutputUpperBoundBytes).toEqual([6_081, 4_999, 6_577, 6_040]);
    expect(extractionPlan.controlPlaneOutputUpperBoundBytes.reduce((sum, bytes) => sum + bytes, 0))
      .toBe(23_697);
    expect(extractionPlan.minimumOutputTokenFloors).toEqual([6_379, 5_297, 6_875, 6_338]);
    expect(extractionPlan.minimumOutputTokenFloors.reduce((sum, floor) => sum + floor, 0))
      .toBe(24_889);
    expect(extractionPlan.minimumOutputTokenFloors.reduce((sum, floor) => sum + floor, 0))
      .toBeLessThan(50_000);
    expect(extractionPlan.inputs.length * OPENAI_MIN_PAID_BATCH_WINDOW_MS).toBe(88_000);
    expect(extractionPlan.controlPlaneOutputPreflightInputs.every((item) =>
      (JSON.parse(item) as { submission_adjudication: { v: number } }).submission_adjudication.v === 5 &&
      !("record_authority" in JSON.parse(item))
    )).toBe(true);
    expect(Math.min(...extractionPlan.controlPlaneOutputUpperBoundBytes.map((bytes) =>
      Math.floor(50_000 / extractionPlan.inputs.length) - bytes
    ))).toBe(5_923);
    expect(50_000 - extractionPlan.controlPlaneOutputUpperBoundBytes.reduce((sum, bytes) => sum + bytes, 0))
      .toBe(26_303);
    expect(dynamicFormatMeasurements(extractionPlan).every((bytes) => bytes < 140_000)).toBe(true);
    const emptyAuthorityReceipt = verifyRecordAuthorities({
      batches: extractionPlan.bindings.map((binding, index) => ({
        binding,
        draft: emptyDraft(),
        authority: boundAuthority(
          emptyDraft(), [], binding, extractionPlan.sourceMaps[index]!, [sourceDocument]
        ),
        sourceMap: extractionPlan.sourceMaps[index]!
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
    const representativeEmail: DraftAnalysis["claims"][number] = {
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
      };
    const representativeRequirements = [representativeRequirement({
        id: "representative-selection",
        topic: "basis of selection",
        category: "financial",
        quote: "The responsive bid with the lowest evaluated price will be recommended for award of\na contract.",
        documentSha256: EDMONTON_SHA256,
        amendmentNumber: null
      }), representativeRequirement({
        id: "representative-security",
        topic: "contract security",
        category: "security",
        quote: "The Contractor must, at all times during the performance of the Contract, hold a valid Designated Organization\nScreening (DOS)",
        documentSha256: EDMONTON_SHA256,
        amendmentNumber: null
      })];
    const representativeDrafts = extractionPlan.sourceMaps.map(() => emptyDraft());
    const representativeRecords = [
      {
        kind: "c" as const, id: representativeEmail.claim_id,
        record: representativeEmail, quote: submissionClause
      },
      ...representativeRequirements.map((record) => ({
        kind: "q" as const, id: record.id, record, quote: record.text
      }))
    ];
    for (const item of representativeRecords) {
      const sourceMapIndex = extractionPlan.sourceMaps.findIndex((sourceMap) =>
        index.pages.some((page) => selectorsForEvidenceRepresentation(sourceMap, {
          document_sha256: EDMONTON_SHA256,
          pdf_page_1based: page.pdfPage1Based,
          evidence_quote: item.quote
        }, [sourceDocument]).length > 0)
      );
      expect(sourceMapIndex, `representative source map for ${item.id}`)
        .toBeGreaterThanOrEqual(0);
      if (item.kind === "c") representativeDrafts[sourceMapIndex]!.claims.push(item.record);
      else representativeDrafts[sourceMapIndex]!.requirements.push(item.record);
    }
    const representativeReceipt = verifyRecordAuthorities({
      batches: extractionPlan.bindings.map((binding, index) => ({
        binding,
        draft: representativeDrafts[index]!,
        authority: boundAuthority(
          representativeDrafts[index]!,
          [
            ...representativeDrafts[index]!.claims.map((_record, ordinal) => [
              "c", ordinal, "s"
            ] as ["c", number, "s"]),
            ...representativeDrafts[index]!.requirements.map((_record, ordinal) => [
              "q", ordinal, "n"
            ] as ["q", number, "n"])
          ],
          binding,
          extractionPlan.sourceMaps[index]!,
          [sourceDocument]
        ),
        sourceMap: extractionPlan.sourceMaps[index]!
      })),
      ledger: submissionLedger,
      submission: submissionAdjudication,
      documents: [sourceDocument],
      mergedDraft: mergeDrafts(representativeDrafts)
    });
    expect(representativeReceipt).toMatchObject({ complete: true, package_veto: false });
    expect(representativeReceipt.receipt_byte_length).toBe(4_123);
    expect(MAX_RECORD_AUTHORITY_RECEIPT_BYTES - representativeReceipt.receipt_byte_length)
      .toBe(258_021);

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
      ledger_digest: "160deb001de1721cb0a31db9f7064f8eb7143b35ec55105a7ffb4e7442565d46",
      expected_page_count: 75,
      covered_page_count: 75,
      metadata_complete: true,
      capacity_exceeded: false
    });
    expect(submissionLedger.candidates).toHaveLength(116);
    const extractionPlan = prepareExtractionPlan(CER_DOCUMENTS.map((document, index) => ({
      document_sha256: document.sha256,
      document_name: document.name,
      role: document.role,
      amendment_number: document.amendment,
      parsed_markdown: indexes.get(document.sha256)!.pages.map((page) => page.text).join("\n"),
      evidence_chunks: indexes.get(document.sha256)!.chunks,
      submission_ledger: index === 0 ? submissionLedger : undefined,
      citation_document: candidateDocuments[index]
    })), modelPlanConfig());
    expect(extractionPlan.packingComplete).toBe(true);
    expect(extractionPlan.inputs).toHaveLength(5);
    expect(extractionPlan.inputs.every((input) =>
      new TextEncoder().encode(input).byteLength <= 140_000
    )).toBe(true);
    expect(extractionPlan.bindings.flatMap((binding) => binding.ordered_candidate_ids).toSorted())
      .toEqual(submissionLedger.candidates.map((candidate) => candidate.candidate_id).toSorted());
    expect(extractionPlan.controlPlaneOutputUpperBoundBytes).toEqual([7420, 6322, 5161, 6407, 9131]);
    expect(extractionPlan.controlPlaneOutputUpperBoundBytes.reduce((sum, bytes) => sum + bytes, 0))
      .toBe(34_441);
    expect(extractionPlan.minimumOutputTokenFloors).toEqual([
      7_718, 6_620, 5_459, 6_705, 9_429
    ]);
    expect(extractionPlan.minimumOutputTokenFloors.reduce((sum, floor) => sum + floor, 0))
      .toBe(35_931);
    expect(protectedOutputTokenCap({
      totalTokens: 50_000,
      accountedTokens: 0,
      floors: extractionPlan.minimumOutputTokenFloors,
      batchIndex: 0
    })).toBe(21_787);
    expect(extractionPlan.controlPlaneOutputPreflightInputs.every((item) =>
      (JSON.parse(item) as { submission_adjudication: { v: number } }).submission_adjudication.v === 5 &&
      !("record_authority" in JSON.parse(item))
    )).toBe(true);
    expect(Math.min(...extractionPlan.controlPlaneOutputUpperBoundBytes.map((bytes) =>
      Math.floor(50_000 / extractionPlan.inputs.length) - bytes
    ))).toBe(869);
    expect(50_000 - extractionPlan.controlPlaneOutputUpperBoundBytes.reduce((sum, bytes) => sum + bytes, 0))
      .toBe(15_559);
    expect(dynamicFormatMeasurements(extractionPlan)).toEqual([
      38_139, 35_901, 30_300, 34_780, 30_298
    ]);
    const submissionAdjudication = verifiedFixtureSubmissionAdjudication(
      candidateDocuments,
      () => undefined,
      { defaultOccurrenceDisposition: "other" }
    );
    const emptyAuthorityReceipt = verifyRecordAuthorities({
      batches: extractionPlan.bindings.map((binding, index) => ({
        binding,
        draft: emptyDraft(),
        authority: boundAuthority(
          emptyDraft(), [], binding, extractionPlan.sourceMaps[index]!, candidateDocuments
        ),
        sourceMap: extractionPlan.sourceMaps[index]!
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
    const driftQuote = representativeQuotes[0]!;
    const driftFragmentText = `Unrelated Monid heading and layout\n${driftQuote.quote}\n` +
      "Unrelated Monid footer and table rendering";
    const driftSourceMap = buildDocumentSourceMap([{
      source_fragment_id: "f".repeat(32),
      document_sha256: driftQuote.document.sha256,
      chunk_id: null,
      text: driftFragmentText
    }], candidateDocuments);
    const driftResolved = resolveSemanticSpan(driftSourceMap, {
      source_fragment_id: "f".repeat(32),
      start_utf16: driftFragmentText.indexOf(driftQuote.quote),
      length_utf16: driftQuote.quote.length
    }, candidateDocuments);
    expect(driftResolved?.evidence_quote).toBe(driftQuote.quote);
    expect(driftResolved?.binding).toMatchObject({
      document_sha256: driftQuote.document.sha256,
      evidence_quote_sha256: sha256Hex(driftQuote.quote),
      alignment_version: RECORD_SOURCE_ALIGNMENT_VERSION
    });
    const representativeDrafts = extractionPlan.sourceMaps.map(() => emptyDraft());
    for (const item of representativeQuotes) {
      const requirement = representativeRequirement({
        id: item.id,
        topic: item.topic,
        category: item.category,
        quote: item.quote,
        documentSha256: item.document.sha256,
        amendmentNumber: item.document.amendment
      });
      const sourceMapIndex = extractionPlan.sourceMaps.findIndex((sourceMap) =>
        candidateDocuments.find((document) =>
          document.index.documentSha256 === item.document.sha256
        )!.index.pages.some((page) => selectorsForEvidenceRepresentation(sourceMap, {
          document_sha256: item.document.sha256,
          pdf_page_1based: page.pdfPage1Based,
          evidence_quote: item.quote
        }, candidateDocuments).length > 0)
      );
      expect(sourceMapIndex, `representative source map for ${item.id}`).toBeGreaterThanOrEqual(0);
      representativeDrafts[sourceMapIndex]!.requirements.push(requirement);
    }
    const representativeReceipt = verifyRecordAuthorities({
      batches: extractionPlan.bindings.map((binding, index) => ({
        binding,
        draft: representativeDrafts[index]!,
        authority: boundAuthority(
          representativeDrafts[index]!,
          representativeDrafts[index]!.requirements.map((_record, ordinal) => [
            "q", ordinal, "n"
          ]),
          binding,
          extractionPlan.sourceMaps[index]!,
          candidateDocuments
        ),
        sourceMap: extractionPlan.sourceMaps[index]!
      })),
      ledger: submissionLedger,
      submission: submissionAdjudication,
      documents: candidateDocuments,
      mergedDraft: mergeDrafts(representativeDrafts)
    });
    expect(representativeReceipt).toMatchObject({ complete: true, package_veto: false });
    expect(representativeReceipt.receipt_byte_length).toBe(6_429);
    expect(MAX_RECORD_AUTHORITY_RECEIPT_BYTES - representativeReceipt.receipt_byte_length)
      .toBe(255_715);

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

    const goldenBindings = allCerCitations().map((citation) => {
      if (citation.pdf_page_1based === null) {
        throw new Error(`Frozen citation has no physical page: ${citation.document_name}`);
      }
      const pdfPage1Based = citation.pdf_page_1based;
      const fragmentMatches = extractionPlan.sourceMaps.flatMap((sourceMap) =>
        selectorsForEvidenceRepresentation(sourceMap, {
          document_sha256: citation.document_sha256,
          pdf_page_1based: pdfPage1Based,
          evidence_quote: citation.evidence_quote
        }, candidateDocuments).map((selector) => ({ sourceMap, selector }))
      );
      const sourceMapFragments = extractionPlan.sourceMaps.flatMap((sourceMap) =>
        [...sourceMap.fragments.values()].filter((fragment) =>
          fragment.document_sha256 === citation.document_sha256
        )
      );
      expect(fragmentMatches, `source selector for ${citation.document_name} p${citation.pdf_page_1based}; ` +
        `fragments=${sourceMapFragments.length}`)
        .not.toHaveLength(0);
      const match = fragmentMatches[0]!;
      const resolved = resolveSemanticSpan(match.sourceMap, match.selector, candidateDocuments);
      const physicalPage = candidateDocuments.find((document) =>
        document.index.documentSha256 === citation.document_sha256
      )!.index.pages[pdfPage1Based - 1]!;
      expect(resolved?.evidence_quote).toBe(physicalPage.text.slice(
        resolved!.binding.evidence_start_utf16,
        resolved!.binding.evidence_end_utf16
      ));
      expect(normalizeEvidenceText(resolved!.evidence_quote))
        .toBe(normalizeEvidenceText(citation.evidence_quote));
      expect(resolved?.binding).toMatchObject({
        document_sha256: citation.document_sha256,
        pdf_page_1based: citation.pdf_page_1based,
        evidence_quote_sha256: sha256Hex(resolved!.evidence_quote),
        alignment_version: RECORD_SOURCE_ALIGNMENT_VERSION
      });
      return {
        document_sha256: resolved!.binding.document_sha256,
        pdf_page_1based: resolved!.binding.pdf_page_1based,
        evidence_start_utf16: resolved!.binding.evidence_start_utf16,
        evidence_end_utf16: resolved!.binding.evidence_end_utf16,
        evidence_quote_sha256: resolved!.binding.evidence_quote_sha256
      };
    });
    expect(goldenBindings).toHaveLength(allCerCitations().length);
    expect(sha256Hex(JSON.stringify(goldenBindings))).toMatch(/^[a-f0-9]{64}$/);

    assertFrozenCitationsAgainstVerifier(allCerCitations(), documents);
  }, 60_000);
});
