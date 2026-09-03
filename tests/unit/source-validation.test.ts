import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "@/lib/crypto";
import {
  assertAggregatePages,
  normalizeFilename,
  ownerUploadNamespace,
  validateCanadaBuysUrl,
  validateCreateRunRequest
} from "@/lib/source-validation";

describe("source validation", () => {
  it("accepts and canonicalizes only the exact CanadaBuys HTTPS host", () => {
    expect(validateCanadaBuysUrl("https://CANADABUYS.CANADA.CA/path/file.pdf#fragment").toString())
      .toBe("https://canadabuys.canada.ca/path/file.pdf");
    for (const unsafe of [
      "http://canadabuys.canada.ca/file.pdf",
      "https://evil.canadabuys.canada.ca/file.pdf",
      "https://canadabuys.canada.ca.evil.test/file.pdf",
      "https://user:pass@canadabuys.canada.ca/file.pdf",
      "https://canadabuys.canada.ca:444/file.pdf"
    ]) {
      expect(() => validateCanadaBuysUrl(unsafe)).toThrow(/Only HTTPS URLs/);
    }
  });

  it("requires exactly one base and no more than five documents", () => {
    expect(() => validateCreateRunRequest({
      documents: [{ role: "amendment", source: { type: "url", url: "https://canadabuys.canada.ca/a.pdf" } }]
    })).toThrow(/Exactly one base/);
    expect(() => validateCreateRunRequest({
      documents: Array.from({ length: 6 }, (_, index) => ({
        role: index === 0 ? "base" : "amendment",
        source: { type: "url", url: `https://canadabuys.canada.ca/${index}.pdf` }
      }))
    })).toThrow(/Too big|maximum/i);
  });

  it("binds upload paths to the owning session namespace", () => {
    const secret = "a sufficiently long upload namespace secret";
    const owner = "guest:owner-a";
    const namespace = ownerUploadNamespace(owner, secret);
    expect(namespace).toBe(hmacSha256Hex(secret, `upload:${owner}`).slice(0, 24));
    const input = {
      documents: [{
        role: "base",
        source: {
          type: "upload",
          blob_path: `incoming/${namespace}/abc/${"a".repeat(64)}.pdf`,
          sha256: "a".repeat(64),
          size_bytes: 10,
          filename: "safe.pdf"
        }
      }]
    };
    expect(validateCreateRunRequest(input, { ownerId: owner, uploadSecret: secret })).toEqual(input);
    expect(() => validateCreateRunRequest(input, { ownerId: "guest:other", uploadSecret: secret }))
      .toThrow(/invalid for this session/);
  });

  it("rejects unsafe filenames, oversize uploads, and packages above 300 pages", () => {
    expect(() => normalizeFilename("../source.pdf")).toThrow(/safe PDF/);
    expect(() => normalizeFilename("source.txt")).toThrow(/safe PDF/);
    expect(() => assertAggregatePages([200, 101])).toThrow(/maximum is 300/);
  });
});
