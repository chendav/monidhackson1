import { describe, expect, it } from "vitest";
import { buildPdfPageIndex } from "@/lib/pdf/page-index";
import { makeMinimalPdf } from "./minimal-pdf";

const ENCRYPTED_ONE_PAGE_PDF_BASE64 =
  "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWyA0IDAgUiBdCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9Qcm9kdWNlciA8NTYxMDI3ODc4MT4KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDEgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCA2MTIgNzkyIF0KL1BhcmVudCAxIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8MGU1MjI5MjVhM2U0ZTg3NGMzY2ZhY2JlZjUxMWE3M2FjNGVjMmJkODY1ZGNkM2Q0NjI3NjE0OTE3YWJmZDdlND4KL1UgPDA1ZDk4NjU3YjcyNThkNTAzZjU3MTg2NDhjNmY1ZmNmMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA3NCAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMiAwIFIKL0lEIFsgPDM1MzMzNzM2NjUzNjMzMzA2NjY1NjIzOTM1MzkzNDM0MzkzNTM2MzEzOTM4NjIzNzM0MzkzMzMxMzk2NTM4MzA+IDwzNTMzMzczNjY1MzYzMzMwNjY2NTYyMzkzNTM5MzQzNDM5MzUzNjMxMzkzODYyMzczNDM5MzMzMTM5NjUzODMwPiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK";

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

  it("keeps an image-only page addressable without inventing local text", async () => {
    const index = await buildPdfPageIndex(makeMinimalPdf([""]));

    expect(index.pagesTotal).toBe(1);
    expect(index.pages[0]).toMatchObject({
      pdfPage1Based: 1,
      text: "",
      normalizedText: ""
    });
    expect(index.chunks).toEqual([]);
  });

  it("rejects a password-protected PDF with the dedicated error code", async () => {
    // Synthetic password-protected blank page; it contains no tender data.
    const encrypted = Uint8Array.from(Buffer.from(ENCRYPTED_ONE_PAGE_PDF_BASE64, "base64"));

    await expect(buildPdfPageIndex(encrypted)).rejects.toMatchObject({
      code: "ENCRYPTED_PDF",
      httpStatus: 422
    });
  });

  it("rejects a truncated PDF as unsupported media", async () => {
    const corrupt = new TextEncoder().encode("%PDF-1.7\ntruncated");

    await expect(buildPdfPageIndex(corrupt)).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA",
      httpStatus: 422
    });
  });
});
