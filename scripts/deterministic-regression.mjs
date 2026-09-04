#!/usr/bin/env node

/**
 * Provider-free, repository-owned release regression verifier.
 *
 * Ten reviewed Vitest selections run in separate fixed-argv child processes.
 * The verifier accepts only exact machine-readable test identities/counts and
 * persists a body-free manifest under ignored `.data/`.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER_RELATIVE_PATH = "scripts/deterministic-regression.mjs";
const OFFICIAL_MANIFEST_RELATIVE_PATH = "docs/specs/MH-001-rfp-xray/official-source-manifest.json";
const OFFICIAL_MANIFEST_PATH = path.join(ROOT, OFFICIAL_MANIFEST_RELATIVE_PATH);
const VITEST_PATH = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const EVIDENCE_DIRECTORY = path.join(ROOT, ".data", "deterministic-regression");
const MAX_CHILD_OUTPUT_BYTES = 2 * 1024 * 1024;
const CHILD_TIMEOUT_MS = 120_000;
const FIXTURE_FILENAMES = Object.freeze({
  "edmonton-100022184-a": "edmonton.pdf",
  "cer-84084-26-0009-a-base": "cer-main.pdf",
  "cer-84084-26-0009-a-amendment-001": "cer-amendment-001.pdf",
  "cer-84084-26-0009-a-amendment-002": "cer-amendment-002.pdf",
  "cer-84084-26-0009-a-amendment-003": "cer-amendment-003.pdf"
});

export const DETERMINISTIC_REGRESSION_CASES = Object.freeze([
  Object.freeze({ id: "official-pdf-hash-pins", file: "tests/golden/deterministic-regression-official.test.ts", pattern: "release deterministic regression official PDF pins", expectedExecuted: 2, expectedIdentitySha256: "59d4b6a0ad8119206ecc6b7e7d325c7e3f57e19bbc809c9363601734dcf94d45" }),
  Object.freeze({ id: "edmonton-golden-baseline", file: "tests/golden/edmonton.test.ts", pattern: "Edmonton 100022184-A manually frozen public sample", expectedExecuted: 8, expectedIdentitySha256: "3510368954376d6becbf9b6c79d611c0e78ee3813bad7d1c323b2ed72d6fbf05" }),
  Object.freeze({ id: "edmonton-golden-fresh-process", file: "tests/golden/edmonton.test.ts", pattern: "Edmonton 100022184-A manually frozen public sample", expectedExecuted: 8, expectedIdentitySha256: "3510368954376d6becbf9b6c79d611c0e78ee3813bad7d1c323b2ed72d6fbf05" }),
  Object.freeze({ id: "cer-golden-shuffled-and-amended", file: "tests/golden/cer.test.ts", pattern: "CER base plus amendments manually frozen public sample", expectedExecuted: 7, expectedIdentitySha256: "293e791e1bbc3afc45d0ed08278c4650b236e4c9f33ec58af29036bfa0978f54" }),
  Object.freeze({ id: "cer-golden-fresh-process", file: "tests/golden/cer.test.ts", pattern: "CER base plus amendments manually frozen public sample", expectedExecuted: 7, expectedIdentitySha256: "293e791e1bbc3afc45d0ed08278c4650b236e4c9f33ec58af29036bfa0978f54" }),
  Object.freeze({ id: "idempotency-and-workflow-resume", file: "tests/integration/api-contract.test.ts", pattern: "versioned public API contract", expectedExecuted: 11, expectedIdentitySha256: "c57b70d24d22979d6e091ec6470321de4f8bb58f489d56b24f1c01f4bf01f8c1" }),
  Object.freeze({ id: "cleanup-failure-and-delay", file: "tests/integration/cleanup-gate.test.ts", pattern: "cleanup readiness gate", expectedExecuted: 2, expectedIdentitySha256: "41d71ce146255b4fbae16770006acf5502a10b1382fb883498ce0ea06038f96b" }),
  Object.freeze({ id: "source-binding-and-submission-safety", file: "tests/unit/record-authority.test.ts", pattern: "T7 record-bound semantic authority|T9 source-ledger package authority|T16 deterministic Monid-to-PDF.js source binding|T17 selector-scoped physical alignment|T21 selector-authenticated presentation materialization", expectedExecuted: 81, expectedIdentitySha256: "32e00055f84c91fe2979a6487317896c0515cfcf990d2c86ab1b2ef7857abdf0" }),
  Object.freeze({ id: "structured-output-completeness-and-usage", file: "tests/unit/openai-adapter.test.ts", pattern: "OpenAI Responses structured output adapter", expectedExecuted: 54, expectedIdentitySha256: "fc94f042a809cbcc53ba5fb400ff66e41329a11f887566548f873c9f8ac9b823" }),
  Object.freeze({ id: "budget-and-idempotency-mutation", file: "tests/unit/security-budget.test.ts", pattern: "security, idempotency, quotas, and budget", expectedExecuted: 6, expectedIdentitySha256: "47183b3eb8fb1dc47f2cf2666a5af88a625fd1934769b9ef0bb811bc2354f2fa" })
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

function cleanChildEnvironment(fixtureDirectory) {
  const allowed = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "USERPROFILE"];
  const environment = Object.fromEntries(allowed
    .filter((key) => typeof process.env[key] === "string")
    .map((key) => [key, process.env[key]]));
  return {
    ...environment,
    NODE_ENV: "test",
    CI: "true",
    NO_COLOR: "1",
    RFP_XRAY_FIXTURE_DIR: fixtureDirectory
  };
}

function spawnFixed(command, args, { cwd = ROOT, environment } = {}) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const diagnosticDigest = createHash("sha256");
    const stdout = [];
    let bytes = 0;
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stop = (error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    const timeout = setTimeout(() => stop(new Error("REGRESSION_CHILD_TIMEOUT")), CHILD_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_CHILD_OUTPUT_BYTES) return stop(new Error("REGRESSION_CHILD_OUTPUT_LIMIT_EXCEEDED"));
      stdout.push(chunk);
      diagnosticDigest.update(chunk);
    });
    child.stderr.on("data", (chunk) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_CHILD_OUTPUT_BYTES) return stop(new Error("REGRESSION_CHILD_OUTPUT_LIMIT_EXCEEDED"));
      diagnosticDigest.update(chunk);
    });
    child.once("error", () => stop(new Error("REGRESSION_CHILD_SPAWN_FAILED")));
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      resolve({
        exit_code: Number.isInteger(code) ? code : null,
        signal: signal ?? null,
        elapsed_ms: Math.round(performance.now() - started),
        output_byte_length: bytes,
        diagnostic_output_sha256: diagnosticDigest.digest("hex"),
        structured_output: Buffer.concat(stdout).toString("utf8")
      });
    });
  });
}

export function validateStructuredTestResult(raw, caseDefinition) {
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    throw new Error(`REGRESSION_STRUCTURED_RESULT_INVALID:${caseDefinition.id}`);
  }
  const testResults = Array.isArray(report?.testResults) ? report.testResults : [];
  const assertions = testResults.flatMap((result) =>
    Array.isArray(result?.assertionResults) ? result.assertionResults : []
  );
  const names = assertions.map((assertion) => assertion?.fullName).sort();
  const identitySha256 = sha256(JSON.stringify(names));
  const valid = report?.success === true && report?.numTotalTests === caseDefinition.expectedExecuted &&
    report?.numPassedTests === caseDefinition.expectedExecuted && report?.numFailedTests === 0 &&
    report?.numPendingTests === 0 && report?.numTodoTests === 0 &&
    report?.numFailedTestSuites === 0 && report?.numPendingTestSuites === 0 &&
    Number.isInteger(report?.numTotalTestSuites) && report.numTotalTestSuites > 0 &&
    report?.numPassedTestSuites === report.numTotalTestSuites &&
    report?.snapshot?.failure === false &&
    testResults.length === 1 && testResults[0]?.status === "passed" &&
    path.resolve(testResults[0]?.name ?? "") === path.join(ROOT, caseDefinition.file) &&
    assertions.length === caseDefinition.expectedExecuted &&
    assertions.every((assertion) => assertion?.status === "passed" &&
      Array.isArray(assertion.failureMessages) && assertion.failureMessages.length === 0) &&
    names.every((name) => typeof name === "string" && name.length > 0) &&
    identitySha256 === caseDefinition.expectedIdentitySha256;
  if (!valid) throw new Error(`REGRESSION_TEST_SUMMARY_MISMATCH:${caseDefinition.id}`);
  const summary = {
    executed_test_count: caseDefinition.expectedExecuted,
    passed_test_count: caseDefinition.expectedExecuted,
    failed_test_count: 0,
    skipped_test_count: 0,
    todo_test_count: 0,
    test_identity_sha256: identitySha256
  };
  return { ...summary, structured_test_summary_sha256: sha256(stableJson(summary)) };
}

export async function verifyOfficialFixtureSet(fixtureDirectory, manifest) {
  if (!manifest || !Array.isArray(manifest.documents) ||
    manifest.documents.length !== Object.keys(FIXTURE_FILENAMES).length) {
    throw new Error("REGRESSION_OFFICIAL_MANIFEST_INVALID");
  }
  const result = [];
  for (const [id, filename] of Object.entries(FIXTURE_FILENAMES)) {
    const document = manifest.documents.find((item) => item?.id === id);
    if (!document || !Number.isInteger(document.bytes) || document.bytes <= 0 ||
      typeof document.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(document.sha256)) {
      throw new Error("REGRESSION_OFFICIAL_MANIFEST_INVALID");
    }
    let bytes;
    try {
      bytes = await readFile(path.join(fixtureDirectory, filename));
    } catch {
      throw new Error("REGRESSION_OFFICIAL_FIXTURE_MISSING");
    }
    if (bytes.byteLength !== document.bytes || sha256(bytes) !== document.sha256) {
      throw new Error("REGRESSION_OFFICIAL_FIXTURE_MISMATCH");
    }
    result.push({ id, bytes: document.bytes, sha256: document.sha256 });
  }
  return { document_count: result.length, fixture_set_sha256: sha256(stableJson(result)) };
}

async function resolveFixtureDirectoryIdentity(fixtureDirectory) {
  let resolved;
  let stats;
  try {
    resolved = await realpath(fixtureDirectory);
    stats = await lstat(resolved);
  } catch {
    throw new Error("REGRESSION_OFFICIAL_FIXTURE_DIRECTORY_CHANGED");
  }
  if (!stats.isDirectory()) throw new Error("REGRESSION_OFFICIAL_FIXTURE_DIRECTORY_CHANGED");
  return stableJson({
    real_path: resolved,
    device: String(stats.dev),
    inode: String(stats.ino)
  });
}

async function resolveCandidateHead() {
  const result = await spawnFixed("git", ["rev-parse", "HEAD"], {
    environment: cleanChildEnvironment(path.join(ROOT, ".data", "official-fixtures"))
  });
  const head = result.structured_output.trim();
  if (result.exit_code !== 0 || !/^[a-f0-9]{40}$/.test(head)) throw new Error("REGRESSION_GIT_HEAD_INVALID");
  return head;
}

async function requireRepositoryInputsClean() {
  const checkedPaths = [
    "src", "tests", "scripts", "vitest.config.ts", "package.json", "pnpm-lock.yaml",
    OFFICIAL_MANIFEST_RELATIVE_PATH
  ];
  const result = await spawnFixed("git", [
    "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...checkedPaths
  ], { environment: cleanChildEnvironment(path.join(ROOT, ".data", "official-fixtures")) });
  if (result.exit_code !== 0 || result.signal !== null) throw new Error("REGRESSION_GIT_STATUS_UNAVAILABLE");
  if (Buffer.byteLength(result.structured_output) !== 0) throw new Error("REGRESSION_REPOSITORY_INPUTS_DIRTY");
}

async function atomicWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
}

async function validateOutputPath(outputPath) {
  const resolved = path.resolve(outputPath ?? "");
  if (path.extname(resolved) !== ".json") throw new Error("REGRESSION_OUTPUT_PATH_INVALID");
  const dataRoot = await realpath(path.join(ROOT, ".data"));
  const targetRelative = path.relative(dataRoot, resolved);
  if (targetRelative.startsWith("..") || path.isAbsolute(targetRelative)) {
    throw new Error("REGRESSION_OUTPUT_PATH_INVALID");
  }
  await mkdir(path.dirname(resolved), { recursive: true });
  const parent = await realpath(path.dirname(resolved));
  const relative = path.relative(dataRoot, parent);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("REGRESSION_OUTPUT_PATH_INVALID");
  try {
    if ((await lstat(resolved)).isSymbolicLink()) throw new Error("REGRESSION_OUTPUT_PATH_INVALID");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return resolved;
}

async function executionIdentity() {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const vitestPackage = JSON.parse(await readFile(path.join(ROOT, "node_modules", "vitest", "package.json"), "utf8"));
  if (Number(process.versions.node.split(".")[0]) !== 22 || packageJson.engines?.node !== "22.x" ||
    packageJson.devDependencies?.vitest !== vitestPackage.version) {
    throw new Error("REGRESSION_RUNTIME_IDENTITY_MISMATCH");
  }
  return {
    node_version: process.version,
    node_abi: process.versions.modules,
    vitest_version: vitestPackage.version,
    vitest_entry_sha256: await sha256File(VITEST_PATH)
  };
}

export async function runDeterministicRegression({
  expectedCandidateCommit,
  expectedFixtureManifestSha256,
  fixtureDirectory,
  spawnCase,
  resolveHead = resolveCandidateHead,
  requireClean = requireRepositoryInputsClean,
  verifySnapshot,
  evidenceWriter = atomicWrite,
  validateResult = validateStructuredTestResult,
  resolveExecutionIdentity = executionIdentity,
  verifyFixtures = verifyOfficialFixtureSet,
  resolveFixtureDirectory = resolveFixtureDirectoryIdentity,
  outputPath = path.join(EVIDENCE_DIRECTORY, `release-${expectedCandidateCommit}.json`),
  now = () => new Date()
}) {
  if (!/^[a-f0-9]{40}$/.test(expectedCandidateCommit ?? "")) throw new Error("REGRESSION_EXPECTED_COMMIT_INVALID");
  if (!/^[a-f0-9]{64}$/.test(expectedFixtureManifestSha256 ?? "")) throw new Error("REGRESSION_FIXTURE_MANIFEST_PIN_INVALID");
  const resolvedFixtureDirectory = path.resolve(fixtureDirectory ?? "");
  const candidateCommit = await resolveHead();
  if (candidateCommit !== expectedCandidateCommit) throw new Error("REGRESSION_CANDIDATE_COMMIT_MISMATCH");

  const sourceFiles = [...new Set(DETERMINISTIC_REGRESSION_CASES.map((item) => item.file))].sort();
  const semanticFiles = [
    RUNNER_RELATIVE_PATH, ...sourceFiles, "vitest.config.ts", "package.json", "pnpm-lock.yaml",
    OFFICIAL_MANIFEST_RELATIVE_PATH
  ];
  await requireClean();
  const semanticSourceSha256 = Object.fromEntries(await Promise.all(semanticFiles.map(async (relativePath) => [
    relativePath,
    await sha256File(path.join(ROOT, relativePath))
  ])));
  const rawManifest = JSON.parse(await readFile(OFFICIAL_MANIFEST_PATH, "utf8"));
  const actualFixtureManifestSha256 = sha256(stableJson(rawManifest));
  if (actualFixtureManifestSha256 !== expectedFixtureManifestSha256) {
    throw new Error("REGRESSION_FIXTURE_MANIFEST_MISMATCH");
  }
  const fixtureDirectoryIdentity = await resolveFixtureDirectory(resolvedFixtureDirectory);
  const officialFixtures = await verifyFixtures(resolvedFixtureDirectory, rawManifest);
  if (await resolveFixtureDirectory(resolvedFixtureDirectory) !== fixtureDirectoryIdentity) {
    throw new Error("REGRESSION_OFFICIAL_FIXTURE_DIRECTORY_CHANGED");
  }
  const runtime = await resolveExecutionIdentity();
  const testManifestSha256 = sha256(stableJson(DETERMINISTIC_REGRESSION_CASES));
  const assertRepositorySnapshot = verifySnapshot ?? (async () => {
    if (await resolveHead() !== candidateCommit) throw new Error("REGRESSION_CANDIDATE_CHANGED");
    await requireClean();
    for (const [relativePath, expectedSha256] of Object.entries(semanticSourceSha256)) {
      if (await sha256File(path.join(ROOT, relativePath)) !== expectedSha256) {
        throw new Error("REGRESSION_SEMANTIC_INPUT_CHANGED");
      }
    }
    const currentRuntime = await resolveExecutionIdentity();
    if (stableJson(currentRuntime) !== stableJson(runtime)) throw new Error("REGRESSION_RUNTIME_CHANGED");
  });
  const assertSnapshot = async () => {
    await assertRepositorySnapshot();
    const currentOfficialFixtures = await verifyFixtures(resolvedFixtureDirectory, rawManifest);
    if (currentOfficialFixtures.document_count !== officialFixtures.document_count ||
      currentOfficialFixtures.fixture_set_sha256 !== officialFixtures.fixture_set_sha256) {
      throw new Error("REGRESSION_OFFICIAL_FIXTURE_SET_CHANGED");
    }
    if (await resolveFixtureDirectory(resolvedFixtureDirectory) !== fixtureDirectoryIdentity) {
      throw new Error("REGRESSION_OFFICIAL_FIXTURE_DIRECTORY_CHANGED");
    }
  };
  await assertSnapshot();
  const execute = spawnCase ?? (async (request) => spawnFixed(request.command, request.args, request.options));
  const results = [];
  for (const caseDefinition of DETERMINISTIC_REGRESSION_CASES) {
    const args = [VITEST_PATH, "run", caseDefinition.file, "-t", caseDefinition.pattern,
      "--reporter=json", "--no-file-parallelism"];
    const request = {
      caseDefinition,
      command: process.execPath,
      args,
      options: {
        cwd: ROOT,
        environment: cleanChildEnvironment(resolvedFixtureDirectory),
        shell: false
      }
    };
    const result = await execute(request);
    if (result?.exit_code !== 0 || result?.signal !== null) {
      throw new Error(`REGRESSION_CASE_FAILED:${caseDefinition.id}`);
    }
    const summary = validateResult(result.structured_output, caseDefinition);
    const argv = ["node", "node_modules/vitest/vitest.mjs", "run", caseDefinition.file, "-t",
      caseDefinition.pattern, "--reporter=json", "--no-file-parallelism"];
    results.push({
      case_id: caseDefinition.id,
      test_source_sha256: semanticSourceSha256[caseDefinition.file],
      argv,
      exit_code: result.exit_code,
      signal: result.signal,
      elapsed_ms: result.elapsed_ms,
      output_byte_length: result.output_byte_length,
      diagnostic_output_sha256: result.diagnostic_output_sha256,
      ...summary
    });
    await assertSnapshot();
  }

  const evidence = {
    schema_version: "2",
    evidence_class: "deterministic_regression",
    authentication: "reviewed_repository_tests",
    candidate_commit: candidateCommit,
    official_manifest_sha256: semanticSourceSha256[OFFICIAL_MANIFEST_RELATIVE_PATH],
    official_fixture_set_sha256: officialFixtures.fixture_set_sha256,
    fixture_manifest_semantic_sha256: actualFixtureManifestSha256,
    runner_source_sha256: semanticSourceSha256[RUNNER_RELATIVE_PATH],
    test_manifest_sha256: testManifestSha256,
    execution_semantic_source_sha256: semanticSourceSha256,
    node_version: runtime.node_version,
    node_abi: runtime.node_abi,
    vitest_version: runtime.vitest_version,
    vitest_entry_sha256: runtime.vitest_entry_sha256,
    required_cases: 10,
    passed_cases: results.length,
    failed_cases: 0,
    verdict: "pass",
    generated_at: now().toISOString(),
    cases: results
  };
  const evidenceFileSha256 = sha256(`${JSON.stringify(evidence, null, 2)}\n`);
  const evidencePath = await validateOutputPath(outputPath);
  await assertSnapshot();
  await evidenceWriter(evidencePath, evidence);
  return {
    evidencePath,
    evidence: {
      evidence_class: evidence.evidence_class,
      authentication: evidence.authentication,
      candidate_commit: evidence.candidate_commit,
      official_manifest_sha256: evidence.official_manifest_sha256,
      official_fixture_set_sha256: evidence.official_fixture_set_sha256,
      fixture_manifest_semantic_sha256: evidence.fixture_manifest_semantic_sha256,
      runner_source_sha256: evidence.runner_source_sha256,
      test_manifest_sha256: evidence.test_manifest_sha256,
      structured_test_summary_sha256: sha256(stableJson(results.map((item) => ({
        case_id: item.case_id,
        structured_test_summary_sha256: item.structured_test_summary_sha256
      })))),
      evidence_file_sha256: evidenceFileSha256,
      node_version: evidence.node_version,
      node_abi: evidence.node_abi,
      vitest_version: evidence.vitest_version,
      vitest_entry_sha256: evidence.vitest_entry_sha256,
      required_cases: evidence.required_cases,
      passed_cases: evidence.passed_cases,
      failed_cases: evidence.failed_cases,
      verdict: evidence.verdict,
      generated_at: evidence.generated_at
    }
  };
}

function parseCli(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--candidate-commit", "--fixture-manifest-sha256", "--fixture-dir", "--output"].includes(key) || !value) {
      throw new Error("REGRESSION_ARGUMENTS_INVALID");
    }
    values[key] = value;
  }
  return {
    expectedCandidateCommit: values["--candidate-commit"],
    expectedFixtureManifestSha256: values["--fixture-manifest-sha256"],
    fixtureDirectory: values["--fixture-dir"],
    outputPath: values["--output"]
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const result = await runDeterministicRegression(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result.evidence)}\n`);
  } catch (error) {
    const code = String(error?.message ?? "REGRESSION_FAILED").split(":")[0];
    process.stderr.write(`[deterministic-regression] stopped code=${/^[A-Z0-9_]+$/.test(code) ? code : "REGRESSION_FAILED"}\n`);
    process.exitCode = 1;
  }
}
