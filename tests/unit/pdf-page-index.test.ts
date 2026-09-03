import { describe, expect, it } from "vitest";
import { buildPdfPageIndex } from "@/lib/pdf/page-index";
import { makeMinimalPdf } from "./minimal-pdf";

describe("PDF.js physical page indexing", () => {
  it("uses 1-based physical pages and builds stable SHA-bound chunks", async () => {
    const pdf = makeMinimalPdf([
      "The bidder must provide one reference.",
      "The second physical page contains pricing."
    ]);
    const index = await buildPdfPageIndex(pdf);
    expect(index.pagesTotal).toBe(2);
    expect(index.pages.map((page) => page.pdfPage1Based)).toEqual([1, 2]);
    expect(index.pages[1].text).toContain("second physical page");
    expect(index.documentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(index.representationSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(index.chunks.every((chunk) => chunk.documentSha256 === index.documentSha256)).toBe(true);
    expect(index.embeddedJavaScriptDetected).toBe(false);
  });
});
