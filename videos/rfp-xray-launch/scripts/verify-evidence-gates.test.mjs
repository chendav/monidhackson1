import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { REQUIRED_GATE_IDS, verifyEvidenceGates } from "./verify-evidence-gates.mjs";

function makeProject({ storyboard = "Ready.", script = "Ready.", mutateGate } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rfp-xray-evidence-gate-"));
  const evidenceDirectory = join(root, "assets", "evidence");
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidencePath = join(evidenceDirectory, "campaign.json");
  const evidence = '{"source":"sanitized-test-fixture"}\n';
  writeFileSync(evidencePath, evidence);
  const hash = createHash("sha256").update(evidence).digest("hex");

  const gates = REQUIRED_GATE_IDS.map((id, index) => {
    const checked = mutateGate?.({ id, index }) ?? true;
    return [
      `- [${checked ? "x" : " "}] \`${id}\` — fixture`,
      "  - Evidence: `assets/evidence/campaign.json`",
      `  - SHA-256: \`${hash}\``,
    ].join("\n");
  }).join("\n");

  writeFileSync(join(root, "STORYBOARD.md"), storyboard);
  writeFileSync(join(root, "SCRIPT.md"), script);
  writeFileSync(join(root, "ASSET_GATES.md"), gates);
  writeFileSync(join(root, "index.html"), "<div>Verified composition</div>");

  return root;
}

function withProject(options, callback) {
  const root = makeProject(options);
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("passes only when every required gate is closed with matching evidence", () => {
  withProject({}, (root) => {
    assert.deepEqual(verifyEvidenceGates(root).findings, []);
  });
});

test("blocks concrete and wildcard LIVE templates", () => {
  withProject({ storyboard: "{{LIVE_TOTAL_COST_USD}} and {{LIVE_*}}" }, (root) => {
    const result = verifyEvidenceGates(root);
    assert.equal(result.ok, false);
    assert.equal(result.findings.filter(({ code }) => code === "LIVE_TEMPLATE").length, 2);
  });
});

test("blocks PENDING_LIVE in a publishable source", () => {
  withProject({ script: "Evidence: PENDING_LIVE" }, (root) => {
    assert.ok(verifyEvidenceGates(root).findings.some(({ code }) => code === "PENDING_LIVE"));
  });
});

test("blocks an unchecked checklist gate", () => {
  withProject({ mutateGate: ({ index }) => index !== 2 }, (root) => {
    const open = verifyEvidenceGates(root).findings.filter(({ code }) => code === "OPEN_GATE");
    assert.equal(open.length, 1);
    assert.match(open[0].message, new RegExp(REQUIRED_GATE_IDS[2]));
  });
});

test("blocks a checked gate when the recorded evidence hash is wrong", () => {
  withProject({}, (root) => {
    const gateFile = join(root, "ASSET_GATES.md");
    const original = readFileSync(gateFile, "utf8");
    writeFileSync(gateFile, original.replace(/[a-f0-9]{64}/, "0".repeat(64)));
    assert.ok(
      verifyEvidenceGates(root).findings.some(({ code }) => code === "EVIDENCE_HASH_MISMATCH"),
    );
  });
});

test("scans nested composition sources", () => {
  withProject({}, (root) => {
    const frames = join(root, "compositions", "frames");
    mkdirSync(frames, { recursive: true });
    writeFileSync(join(frames, "08-audit-cost.html"), "<p>{{LIVE_TOTAL_COST_USD}}</p>");
    const finding = verifyEvidenceGates(root).findings.find(({ code }) => code === "LIVE_TEMPLATE");
    assert.equal(finding?.file, "compositions/frames/08-audit-cost.html");
  });
});
