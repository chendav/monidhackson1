import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto";
import { assertionTokensSupportedByCitations, verifyCitation } from "@/lib/evidence/citations";
import { normalizeEvidenceText, type PdfPageIndex } from "@/lib/pdf/page-index";

const documentSha = "a".repeat(64);
const index: PdfPageIndex = {
  documentSha256: documentSha,
  representationSha256: sha256Hex("representation"),
  pagesTotal: 2,
  pages: [
    { pdfPage1Based: 1, printedPageLabel: "i", text: "Cover material.", normalizedText: normalizeEvidenceText("Cover material."), representationSha256: sha256Hex("cover") },
    { pdfPage1Based: 2, printedPageLabel: "1", text: "The Bidder must provide up to three resources.", normalizedText: normalizeEvidenceText("The Bidder must provide up to three resources."), representationSha256: sha256Hex("body") }
  ],
  chunks: [{ chunkId: "opaque-chunk", documentSha256: documentSha, text: "The Bidder must provide up to three resources." }],
  embeddedJavaScriptDetected: false,
  indexVersion: "pdfjs-1based-v1"
};
const documents = [{ name: "source.pdf", sourceUrl: null, index }];

describe("SHA-bound citation verification", () => {
  it("attaches the server-determined 1-based physical page and receipt hashes", () => {
    const verified = verifyCitation({
      documentSha256: documentSha,
      chunkId: "opaque-chunk",
      evidenceQuote: "The Bidder must provide up to three resources.",
      section: "M3"
    }, documents, new Date("2026-09-02T00:00:00Z"));
    expect(verified.citation).toMatchObject({
      pdf_page_1based: 2,
      printed_page_label: "1",
      verified: true,
      verification_method: "exact"
    });
    expect(verified.receipt).toMatchObject({
      documentSha256: documentSha,
      representationSha256: index.representationSha256,
      pdfPage1Based: 2,
      verified: true,
      verifierVersion: "pdfjs-1based-v1"
    });
    expect(verified.receipt.fragmentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes typography but refuses a wrong SHA or unverifiable quote", () => {
    expect(verifyCitation({
      documentSha256: documentSha,
      evidenceQuote: "the bidder MUST   provide up to three resources."
    }, documents).citation.verification_method).toBe("normalized");
    expect(verifyCitation({ documentSha256: "b".repeat(64), evidenceQuote: "Cover material." }, documents).citation.verified).toBe(false);
    expect(verifyCitation({ documentSha256: documentSha, evidenceQuote: "Invented fact" }, documents).citation).toMatchObject({
      verified: false,
      pdf_page_1based: null,
      verification_method: "manual_required"
    });
  });

  it("canonicalizes equivalent dates/times and rejects different scalar assertions", () => {
    const citation = {
      document_sha256: documentSha,
      document_name: "source.pdf",
      source_url: null,
      pdf_page_1based: 2,
      printed_page_label: null,
      section: null,
      evidence_quote: "Closes September 15, 2026 at 2:00 PM MDT with 70% technical weight.",
      verified: true,
      verification_method: "exact" as const
    };
    expect(assertionTokensSupportedByCitations(
      "Closes 2026-09-15T14:00:00-06:00 with a 70% technical weight.",
      [citation]
    )).toBe(true);
    expect(assertionTokensSupportedByCitations("Closes 2026-09-03 with 70% technical weight.", [citation]))
      .toBe(false);
    expect(assertionTokensSupportedByCitations("The technical weight is 99%.", [citation])).toBe(false);
  });
});
