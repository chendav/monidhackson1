import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = resolve(SCRIPT_DIR, "..");

export const REQUIRED_GATE_IDS = Object.freeze([
  "frame-01-pricing-refresh",
  "frame-03-package-input",
  "frame-04-progress-cleanup-cost",
  "frame-05-evaluation-citations",
  "frame-06-amendment-conflict",
  "frame-07-grounded-qa",
  "frame-08-audit-cost",
  "frame-09-cost-consistency",
  "processing-time-disclosure",
]);

const ROOT_TEXT_FILES = Object.freeze([
  "STORYBOARD.md",
  "SCRIPT.md",
  "ASSET_GATES.md",
  "index.html",
  "audio_meta.json",
  "caption_groups.json",
]);

const SCANNED_COMPOSITION_EXTENSIONS = new Set([".html", ".json", ".md", ".txt"]);

const SENTINELS = Object.freeze([
  {
    code: "LIVE_TEMPLATE",
    regex: /\{\{\s*LIVE_(?:[A-Z0-9_]+|\*)\s*\}\}/g,
    message: "replace the live-value template with reconciled campaign evidence",
  },
  {
    code: "PENDING_LIVE",
    regex: /\bPENDING_LIVE\b/g,
    message: "replace the pending-live marker with the captured evidence reference",
  },
]);

function locationFor(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const lastBreak = before.lastIndexOf("\n");
  return { line, column: offset - lastBreak };
}

function walkCompositionFiles(projectRoot) {
  const compositionRoot = resolve(projectRoot, "compositions");
  if (!existsSync(compositionRoot)) return [];

  const found = [];
  const pending = [compositionRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile() && SCANNED_COMPOSITION_EXTENSIONS.has(extname(entry.name))) {
        found.push(absolutePath);
      }
    }
  }

  return found.sort((left, right) => left.localeCompare(right));
}

function scanSentinels(projectRoot) {
  const candidates = ROOT_TEXT_FILES
    .map((file) => resolve(projectRoot, file))
    .filter((file) => existsSync(file))
    .concat(walkCompositionFiles(projectRoot));

  const findings = [];
  for (const absolutePath of candidates) {
    const text = readFileSync(absolutePath, "utf8");
    const file = relative(projectRoot, absolutePath).replaceAll("\\", "/");

    for (const sentinel of SENTINELS) {
      const matcher = new RegExp(sentinel.regex.source, sentinel.regex.flags);
      for (const match of text.matchAll(matcher)) {
        const { line, column } = locationFor(text, match.index ?? 0);
        findings.push({
          code: sentinel.code,
          file,
          line,
          column,
          message: sentinel.message,
        });
      }
    }
  }
  return findings;
}

function sha256File(absolutePath) {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

function parseChecklist(projectRoot) {
  const absolutePath = resolve(projectRoot, "ASSET_GATES.md");
  if (!existsSync(absolutePath)) {
    return [{
      code: "GATE_FILE_MISSING",
      file: "ASSET_GATES.md",
      line: 1,
      column: 1,
      message: "the evidence checklist is required",
    }];
  }

  const lines = readFileSync(absolutePath, "utf8").split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^- \[([ xX])\] `([a-z0-9-]+)`(?:\s|$)/);
    if (!match) continue;

    let end = index + 1;
    while (end < lines.length && !/^- \[[ xX]\] `[a-z0-9-]+`(?:\s|$)/.test(lines[end])) {
      end += 1;
    }

    blocks.push({
      checked: match[1].toLowerCase() === "x",
      id: match[2],
      line: index + 1,
      lines: lines.slice(index, end),
    });
    index = end - 1;
  }

  const findings = [];
  const seen = new Map();
  for (const block of blocks) {
    if (seen.has(block.id)) {
      findings.push({
        code: "DUPLICATE_GATE",
        file: "ASSET_GATES.md",
        line: block.line,
        column: 1,
        message: `gate ${block.id} duplicates line ${seen.get(block.id)}`,
      });
      continue;
    }
    seen.set(block.id, block.line);

    if (!block.checked) {
      findings.push({
        code: "OPEN_GATE",
        file: "ASSET_GATES.md",
        line: block.line,
        column: 1,
        message: `gate ${block.id} still needs verified live evidence`,
      });
      continue;
    }

    const evidenceLine = block.lines.find((line) => /^\s+- Evidence: `[^`]+`\s*$/.test(line));
    const hashLine = block.lines.find((line) => /^\s+- SHA-256: `[a-fA-F0-9]{64}`\s*$/.test(line));
    if (!evidenceLine || !hashLine) {
      findings.push({
        code: "EVIDENCE_RECORD_INCOMPLETE",
        file: "ASSET_GATES.md",
        line: block.line,
        column: 1,
        message: `checked gate ${block.id} needs exact Evidence and SHA-256 child rows`,
      });
      continue;
    }

    const evidencePath = evidenceLine.match(/`([^`]+)`/)?.[1] ?? "";
    const expectedHash = hashLine.match(/`([a-fA-F0-9]{64})`/)?.[1].toLowerCase() ?? "";
    const absoluteEvidencePath = resolve(projectRoot, evidencePath);
    const relativeEvidencePath = relative(projectRoot, absoluteEvidencePath);
    if (
      isAbsolute(evidencePath)
      || relativeEvidencePath.startsWith("..")
      || isAbsolute(relativeEvidencePath)
    ) {
      findings.push({
        code: "EVIDENCE_PATH_UNSAFE",
        file: "ASSET_GATES.md",
        line: block.line,
        column: 1,
        message: `gate ${block.id} evidence must be a project-relative file`,
      });
      continue;
    }

    if (!existsSync(absoluteEvidencePath) || !statSync(absoluteEvidencePath).isFile()) {
      findings.push({
        code: "EVIDENCE_FILE_MISSING",
        file: "ASSET_GATES.md",
        line: block.line,
        column: 1,
        message: `gate ${block.id} references missing file ${evidencePath}`,
      });
      continue;
    }

    const actualHash = sha256File(absoluteEvidencePath);
    if (actualHash !== expectedHash) {
      findings.push({
        code: "EVIDENCE_HASH_MISMATCH",
        file: "ASSET_GATES.md",
        line: block.line,
        column: 1,
        message: `gate ${block.id} SHA-256 does not match ${evidencePath}`,
      });
    }
  }

  for (const id of REQUIRED_GATE_IDS) {
    if (!seen.has(id)) {
      findings.push({
        code: "REQUIRED_GATE_MISSING",
        file: "ASSET_GATES.md",
        line: 1,
        column: 1,
        message: `required gate ${id} is absent`,
      });
    }
  }

  return findings;
}

export function verifyEvidenceGates(projectRoot = DEFAULT_PROJECT_ROOT) {
  const root = resolve(projectRoot);
  const findings = [...scanSentinels(root), ...parseChecklist(root)]
    .sort((left, right) => (
      left.file.localeCompare(right.file)
      || left.line - right.line
      || left.column - right.column
      || left.code.localeCompare(right.code)
    ));

  return {
    ok: findings.length === 0,
    projectRoot: root,
    findings,
  };
}

function runCli() {
  const result = verifyEvidenceGates();
  if (!result.ok) {
    console.error(`Evidence gate BLOCKED: ${result.findings.length} unresolved finding(s).`);
    for (const finding of result.findings) {
      console.error(
        `- ${finding.file}:${finding.line}:${finding.column} [${finding.code}] ${finding.message}`,
      );
    }
    console.error(
      "Resolve every live sentinel and close every ASSET_GATES.md item with a real project-relative file and matching SHA-256.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Evidence gate PASS: ${REQUIRED_GATE_IDS.length} required gates are closed and hashed.`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli();
}
