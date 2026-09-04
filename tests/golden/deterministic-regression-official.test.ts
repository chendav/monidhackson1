import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fixtureDirectory = process.env.RFP_XRAY_FIXTURE_DIR;
const describeWithOfficialFixtures = fixtureDirectory ? describe : describe.skip;

const manifest = JSON.parse(await readFile(path.resolve(
  "docs/specs/MH-001-rfp-xray/official-source-manifest.json"
), "utf8")) as {
  documents: Array<{ id: string; sha256: string; bytes: number }>;
};

const filenames: Record<string, string> = {
  "edmonton-100022184-a": "edmonton.pdf",
  "cer-84084-26-0009-a-base": "cer-main.pdf",
  "cer-84084-26-0009-a-amendment-001": "cer-amendment-001.pdf",
  "cer-84084-26-0009-a-amendment-002": "cer-amendment-002.pdf",
  "cer-84084-26-0009-a-amendment-003": "cer-amendment-003.pdf"
};

async function expectExactOfficialFile(id: string) {
  const document = manifest.documents.find((item) => item.id === id);
  expect(document, `manifest entry ${id}`).toBeDefined();
  const bytes = await readFile(path.join(fixtureDirectory!, filenames[id]!));
  expect(bytes.byteLength).toBe(document!.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(document!.sha256);
}

describeWithOfficialFixtures("release deterministic regression official PDF pins", () => {
  it("requires the saved Edmonton PDF to match its official manifest bytes and SHA-256", async () => {
    await expectExactOfficialFile("edmonton-100022184-a");
  });

  it("requires all four saved CER PDFs to match their official manifest bytes and SHA-256", async () => {
    for (const id of [
      "cer-84084-26-0009-a-base",
      "cer-84084-26-0009-a-amendment-001",
      "cer-84084-26-0009-a-amendment-002",
      "cer-84084-26-0009-a-amendment-003"
    ]) {
      await expectExactOfficialFile(id);
    }
  });
});
