import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPdfPageIndex, normalizeEvidenceText } from "@/lib/pdf/page-index";
import { CER_DOCUMENTS } from "@/lib/fixtures/cer";
import { EDMONTON_PAGES, EDMONTON_SHA256 } from "@/lib/fixtures/edmonton";

const fixtureDirectory = process.env.RFP_XRAY_FIXTURE_DIR;
const auditIt = fixtureDirectory ? it : it.skip;

describe("optional official-PDF local audit (PDFs are never committed)", () => {
  auditIt("verifies the Edmonton hash/pages and key physical-page evidence", async () => {
    const bytes = new Uint8Array(await readFile(path.join(fixtureDirectory!, "edmonton.pdf")));
    const index = await buildPdfPageIndex(bytes);
    expect(index.documentSha256).toBe(EDMONTON_SHA256);
    expect(index.pagesTotal).toBe(EDMONTON_PAGES);
    expect(index.pages[13].normalizedText).toContain("lowest evaluated price");
    expect(index.pages[16].normalizedText).toContain("attached at annex d");
    expect(index.pages[42].normalizedText).toContain("up to three (3) resources");
    expect(index.pages[42].normalizedText).toContain(normalizeEvidenceText("ANNEX “ E ” - SECURITY REQUIREMENTS CHECK LIST"));
    expect(index.pages[39].normalizedText).toContain("$_______________");
    expect(index.pages[47].normalizedText).toContain("page 1/8");
    expect(index.pages[54].normalizedText).toContain("page 8/8");
  }, 30_000);

  auditIt("verifies all CER hashes/pages and both sides of the amendment-003 conflict", async () => {
    for (const document of CER_DOCUMENTS) {
      const bytes = new Uint8Array(await readFile(path.join(fixtureDirectory!, document.name)));
      const index = await buildPdfPageIndex(bytes);
      expect(index.documentSha256).toBe(document.sha256);
      expect(index.pagesTotal).toBe(document.pages);
      if (document.name === "cer-main.pdf") {
        expect(index.pages[39].normalizedText).toContain("projections roughly 20 to 30 years out from the current year");
      }
      if (document.name === "cer-amendment-003.pdf") {
        expect(index.pages[1].normalizedText).toContain("extend to 2050 for the first contract year");
        expect(index.pages[4].normalizedText).toContain("annual basis projections to 2055");
      }
    }
  }, 30_000);
});
