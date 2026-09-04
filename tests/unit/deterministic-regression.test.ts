import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const regressionPromise = import(new URL("../../scripts/deterministic-regression.mjs", import.meta.url).href) as Promise<{
  DETERMINISTIC_REGRESSION_CASES: ReadonlyArray<{
    id: string;
    file: string;
    pattern: string;
    expectedExecuted: number;
    expectedIdentitySha256: string;
  }>;
  validateStructuredTestResult: (raw: string, definition: Record<string, unknown>) => Record<string, unknown>;
  verifyOfficialFixtureSet: (
    fixtureDirectory: string,
    manifest: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  runDeterministicRegression: (options: Record<string, unknown>) => Promise<{
    evidencePath: string;
    evidence: Record<string, unknown>;
  }>;
}>;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function officialManifestSha256() {
  const value = JSON.parse(await readFile(path.resolve(
    "docs/specs/MH-001-rfp-xray/official-source-manifest.json"
  ), "utf8"));
  return sha256(stableJson(value));
}

const syntheticFixtureFiles = [
  ["edmonton-100022184-a", "edmonton.pdf"],
  ["cer-84084-26-0009-a-base", "cer-main.pdf"],
  ["cer-84084-26-0009-a-amendment-001", "cer-amendment-001.pdf"],
  ["cer-84084-26-0009-a-amendment-002", "cer-amendment-002.pdf"],
  ["cer-84084-26-0009-a-amendment-003", "cer-amendment-003.pdf"]
] as const;

async function createSyntheticFixtureSet() {
  const directory = await mkdtemp(path.join(tmpdir(), "rfp-xray-regression-"));
  temporaryDirectories.push(directory);
  const fixtures = path.join(directory, "fixtures");
  await mkdir(fixtures);
  const documents = [];
  const bodies = new Map<string, Buffer>();
  for (const [index, [id, filename]] of syntheticFixtureFiles.entries()) {
    const bytes = Buffer.from(`official-${index}`);
    bodies.set(filename, bytes);
    await writeFile(path.join(fixtures, filename), bytes);
    documents.push({ id, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return { fixtures, documents, bodies };
}

function structuredReport(names: string[], options: {
  passed?: number;
  failed?: number;
  pending?: number;
  todo?: number;
  status?: string;
  success?: boolean;
} = {}) {
  const passed = options.passed ?? names.length;
  const failed = options.failed ?? 0;
  const pending = options.pending ?? 0;
  const todo = options.todo ?? 0;
  return JSON.stringify({
    success: options.success ?? failed === 0,
    numTotalTests: names.length,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: pending,
    numTodoTests: todo,
    numFailedTestSuites: failed > 0 ? 1 : 0,
    numPendingTestSuites: pending > 0 ? 1 : 0,
    numTotalTestSuites: 2,
    numPassedTestSuites: failed === 0 && pending === 0 ? 2 : 0,
    snapshot: { failure: false },
    testResults: [{
      name: path.resolve("tests/golden/edmonton.test.ts"),
      status: options.status ?? "passed",
      assertionResults: names.map((fullName, index) => ({
        fullName,
        status: index < passed ? "passed" : "skipped",
        failureMessages: []
      }))
    }]
  });
}

function successfulChild(index: number) {
  return {
    exit_code: 0,
    signal: null,
    elapsed_ms: 10 + index,
    output_byte_length: 100 + index,
    diagnostic_output_sha256: String(index + 1).padStart(64, "0"),
    structured_output: "{}"
  };
}

function acceptedSummary(definition: { expectedExecuted: number; expectedIdentitySha256: string }) {
  const summary = {
    executed_test_count: definition.expectedExecuted,
    passed_test_count: definition.expectedExecuted,
    failed_test_count: 0,
    skipped_test_count: 0,
    todo_test_count: 0,
    test_identity_sha256: definition.expectedIdentitySha256
  };
  return { ...summary, structured_test_summary_sha256: sha256(stableJson(summary)) };
}

function baseRunOptions() {
  return {
    expectedCandidateCommit: "a".repeat(40),
    fixtureDirectory: path.resolve(".data/official-fixtures"),
    resolveHead: async () => "a".repeat(40),
    requireClean: async () => undefined,
    verifySnapshot: async () => undefined,
    verifyFixtures: async () => ({ document_count: 5, fixture_set_sha256: "b".repeat(64) }),
    resolveFixtureDirectory: async () => "fixture-directory-identity",
    resolveExecutionIdentity: async () => ({
      node_version: process.version,
      node_abi: process.versions.modules,
      vitest_version: "4.1.11",
      vitest_entry_sha256: "c".repeat(64)
    }),
    validateResult: (_raw: string, definition: { expectedExecuted: number; expectedIdentitySha256: string }) =>
      acceptedSummary(definition),
    evidenceWriter: async () => undefined
  };
}

describe("repository-owned deterministic regression verifier", () => {
  it("pins all 81 source-binding tests and rejects an identity-name drift", async () => {
    const regression = await regressionPromise;
    const definition = regression.DETERMINISTIC_REGRESSION_CASES.find((item) =>
      item.id === "source-binding-and-submission-safety"
    )!;
    expect(definition).toMatchObject({
      expectedExecuted: 81,
      expectedIdentitySha256: "32e00055f84c91fe2979a6487317896c0515cfcf990d2c86ab1b2ef7857abdf0"
    });
    expect(definition.pattern).toContain("T21 selector-authenticated presentation materialization");

    const child = spawnSync(process.execPath, [
      path.resolve("node_modules/vitest/vitest.mjs"),
      "run",
      definition.file,
      "-t",
      definition.pattern,
      "--reporter=json",
      "--no-file-parallelism"
    ], {
      cwd: path.resolve("."),
      env: { ...process.env, NODE_ENV: "test", CI: "true", NO_COLOR: "1" },
      encoding: "utf8",
      shell: false,
      maxBuffer: 2 * 1024 * 1024
    });
    expect(child.status, child.stderr).toBe(0);
    expect(regression.validateStructuredTestResult(child.stdout, definition)).toMatchObject({
      executed_test_count: 81,
      passed_test_count: 81,
      skipped_test_count: 0,
      test_identity_sha256: definition.expectedIdentitySha256
    });

    const drifted = JSON.parse(child.stdout) as {
      testResults: Array<{ assertionResults: Array<{ fullName: string }> }>;
    };
    drifted.testResults[0]!.assertionResults[0]!.fullName += " identity drift";
    expect(() => regression.validateStructuredTestResult(JSON.stringify(drifted), definition))
      .toThrow("REGRESSION_TEST_SUMMARY_MISMATCH:source-binding-and-submission-safety");
  }, 15_000);

  it("runs exactly ten fixed JSON-reporter cases and emits a body-free reviewed-test manifest", async () => {
    const regression = await regressionPromise;
    const seen: string[] = [];
    const requests: Array<Record<string, unknown>> = [];
    const written: Array<Record<string, unknown>> = [];
    const verifyFixtures = vi.fn(async () => ({ document_count: 5, fixture_set_sha256: "b".repeat(64) }));
    const result = await regression.runDeterministicRegression({
      ...baseRunOptions(),
      expectedFixtureManifestSha256: await officialManifestSha256(),
      verifyFixtures,
      spawnCase: async (request: { caseDefinition: { id: string } }) => {
        seen.push(request.caseDefinition.id);
        requests.push(request as unknown as Record<string, unknown>);
        return successfulChild(seen.length);
      },
      evidenceWriter: async (_filePath: string, value: Record<string, unknown>) => written.push(value),
      now: () => new Date("2026-09-04T12:00:00.000Z")
    });
    expect(regression.DETERMINISTIC_REGRESSION_CASES).toHaveLength(10);
    expect(seen).toEqual(regression.DETERMINISTIC_REGRESSION_CASES.map((item) => item.id));
    expect(new Set(seen).size).toBe(10);
    for (const [index, request] of requests.entries()) {
      const definition = regression.DETERMINISTIC_REGRESSION_CASES[index]!;
      expect(request).toMatchObject({
        command: process.execPath,
        args: expect.arrayContaining([
          "run", definition.file, "-t", definition.pattern,
          "--reporter=json", "--no-file-parallelism"
        ]),
        options: { shell: false }
      });
    }
    expect(written).toHaveLength(1);
    expect(verifyFixtures).toHaveBeenCalledTimes(13);
    expect(written[0]).toMatchObject({
      node_version: process.version,
      node_abi: process.versions.modules,
      vitest_version: "4.1.11",
      vitest_entry_sha256: "c".repeat(64),
      execution_semantic_source_sha256: {
        "scripts/deterministic-regression.mjs": expect.stringMatching(/^[a-f0-9]{64}$/),
        "vitest.config.ts": expect.stringMatching(/^[a-f0-9]{64}$/),
        "package.json": expect.stringMatching(/^[a-f0-9]{64}$/),
        "pnpm-lock.yaml": expect.stringMatching(/^[a-f0-9]{64}$/),
        "docs/specs/MH-001-rfp-xray/official-source-manifest.json": expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    });
    expect(result.evidence).toMatchObject({
      evidence_class: "deterministic_regression",
      authentication: "reviewed_repository_tests",
      required_cases: 10,
      passed_cases: 10,
      failed_cases: 0,
      verdict: "pass"
    });
    expect(JSON.stringify(written[0])).not.toMatch(
      /authorization|api_key|signed_url|evidence_quote|document_text|raw_body/i
    );
  });

  it("requires exact structured identities/counts and rejects zero-match, skipped, todo, failure, and drift", async () => {
    const regression = await regressionPromise;
    const names = ["suite first", "suite second"];
    const definition = {
      id: "synthetic",
      file: "tests/golden/edmonton.test.ts",
      expectedExecuted: 2,
      expectedIdentitySha256: sha256(JSON.stringify([...names].sort()))
    };
    expect(regression.validateStructuredTestResult(structuredReport(names), definition)).toMatchObject({
      executed_test_count: 2,
      passed_test_count: 2,
      skipped_test_count: 0,
      todo_test_count: 0
    });
    expect(() => regression.validateStructuredTestResult(structuredReport([], { passed: 0 }), definition))
      .toThrow("REGRESSION_TEST_SUMMARY_MISMATCH");
    expect(() => regression.validateStructuredTestResult(
      structuredReport(names, { passed: 0, pending: 2, status: "skipped" }), definition
    )).toThrow("REGRESSION_TEST_SUMMARY_MISMATCH");
    expect(() => regression.validateStructuredTestResult(
      structuredReport(names, { passed: 1, todo: 1 }), definition
    )).toThrow("REGRESSION_TEST_SUMMARY_MISMATCH");
    expect(() => regression.validateStructuredTestResult(
      structuredReport(names, { passed: 1, failed: 1, success: false, status: "failed" }), definition
    )).toThrow("REGRESSION_TEST_SUMMARY_MISMATCH");
    expect(() => regression.validateStructuredTestResult(structuredReport(["suite renamed", names[1]!]), definition))
      .toThrow("REGRESSION_TEST_SUMMARY_MISMATCH");
    expect(() => regression.validateStructuredTestResult(
      structuredReport([...names, "suite unexpected third"]), definition
    )).toThrow("REGRESSION_TEST_SUMMARY_MISMATCH");
  });

  it("lets ordinary Vitest skip missing external fixtures but rejects that result as runner evidence", async () => {
    const regression = await regressionPromise;
    const environment = { ...process.env };
    delete environment.RFP_XRAY_FIXTURE_DIR;
    const child = spawnSync(process.execPath, [
      path.resolve("node_modules/vitest/vitest.mjs"),
      "run",
      "tests/golden/deterministic-regression-official.test.ts",
      "--reporter=json",
      "--no-file-parallelism"
    ], {
      cwd: path.resolve("."),
      env: environment,
      encoding: "utf8",
      shell: false,
      maxBuffer: 2 * 1024 * 1024
    });
    expect(child.status).toBe(0);
    const report = JSON.parse(child.stdout) as { numPendingTests?: number };
    expect(report.numPendingTests).toBe(2);
    const officialCase = regression.DETERMINISTIC_REGRESSION_CASES[0]!;
    expect(() => regression.validateStructuredTestResult(child.stdout, officialCase))
      .toThrow("REGRESSION_TEST_SUMMARY_MISMATCH:official-pdf-hash-pins");
  });

  it("fails the whole class on one child failure and writes no PASS manifest", async () => {
    const regression = await regressionPromise;
    const writer = vi.fn();
    let count = 0;
    await expect(regression.runDeterministicRegression({
      ...baseRunOptions(),
      expectedFixtureManifestSha256: await officialManifestSha256(),
      spawnCase: async () => {
        count += 1;
        return count === 4 ? { ...successfulChild(count), exit_code: 1 } : successfulChild(count);
      },
      evidenceWriter: writer
    })).rejects.toThrow("REGRESSION_CASE_FAILED:cer-golden-shuffled-and-amended");
    expect(count).toBe(4);
    expect(writer).not.toHaveBeenCalled();
  });

  it("rejects wrong HEAD, dirty config, and execution dependency drift", async () => {
    const regression = await regressionPromise;
    const common = {
      ...baseRunOptions(),
      expectedFixtureManifestSha256: await officialManifestSha256(),
      spawnCase: async () => successfulChild(1)
    };
    await expect(regression.runDeterministicRegression({
      ...common,
      resolveHead: async () => "d".repeat(40)
    })).rejects.toThrow("REGRESSION_CANDIDATE_COMMIT_MISMATCH");
    await expect(regression.runDeterministicRegression({
      ...common,
      requireClean: async () => { throw new Error("REGRESSION_REPOSITORY_INPUTS_DIRTY"); }
    })).rejects.toThrow("REGRESSION_REPOSITORY_INPUTS_DIRTY");

    let identityReads = 0;
    await expect(regression.runDeterministicRegression({
      ...common,
      verifySnapshot: undefined,
      resolveExecutionIdentity: async () => ({
        node_version: process.version,
        node_abi: process.versions.modules,
        vitest_version: identityReads++ === 0 ? "4.1.11" : "4.1.12",
        vitest_entry_sha256: "c".repeat(64)
      })
    })).rejects.toThrow("REGRESSION_RUNTIME_CHANGED");
  });

  it("fails closed for missing or SHA-mismatched saved official PDFs", async () => {
    const regression = await regressionPromise;
    const { fixtures, documents } = await createSyntheticFixtureSet();
    await expect(regression.verifyOfficialFixtureSet(fixtures, { documents })).resolves.toMatchObject({
      document_count: 5,
      fixture_set_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    await rm(path.join(fixtures, "edmonton.pdf"));
    await expect(regression.verifyOfficialFixtureSet(fixtures, { documents }))
      .rejects.toThrow("REGRESSION_OFFICIAL_FIXTURE_MISSING");
    await writeFile(path.join(fixtures, "edmonton.pdf"), "wrong");
    await expect(regression.verifyOfficialFixtureSet(fixtures, { documents }))
      .rejects.toThrow("REGRESSION_OFFICIAL_FIXTURE_MISMATCH");
  });

  it("rechecks the complete official PDF set before work and after every child", async () => {
    const regression = await regressionPromise;
    const fixtureChecks = vi.fn(async () => ({ document_count: 5, fixture_set_sha256: "b".repeat(64) }));
    await regression.runDeterministicRegression({
      ...baseRunOptions(),
      expectedFixtureManifestSha256: await officialManifestSha256(),
      verifyFixtures: fixtureChecks,
      spawnCase: async () => successfulChild(1)
    });
    expect(fixtureChecks).toHaveBeenCalledTimes(13);
  });

  it("fails closed when case one deletes or replaces an official PDF", async () => {
    const regression = await regressionPromise;
    for (const mutation of ["delete", "replace"] as const) {
      const { fixtures, documents } = await createSyntheticFixtureSet();
      const writer = vi.fn();
      let spawned = 0;
      await expect(regression.runDeterministicRegression({
        ...baseRunOptions(),
        expectedFixtureManifestSha256: await officialManifestSha256(),
        fixtureDirectory: fixtures,
        resolveFixtureDirectory: undefined,
        verifyFixtures: (directory: string) =>
          regression.verifyOfficialFixtureSet(directory, { documents }),
        spawnCase: async () => {
          spawned += 1;
          if (spawned === 1) {
            const target = path.join(fixtures, "edmonton.pdf");
            if (mutation === "delete") await rm(target);
            else await writeFile(target, "changed-after-case-one");
          }
          return successfulChild(spawned);
        },
        evidenceWriter: writer
      })).rejects.toThrow(mutation === "delete"
        ? "REGRESSION_OFFICIAL_FIXTURE_MISSING"
        : "REGRESSION_OFFICIAL_FIXTURE_MISMATCH");
      expect(spawned).toBe(1);
      expect(writer).not.toHaveBeenCalled();
    }
  });

  it("fails closed when an official PDF changes immediately before evidence write", async () => {
    const regression = await regressionPromise;
    const { fixtures, documents } = await createSyntheticFixtureSet();
    const writer = vi.fn();
    let snapshots = 0;
    let fixtureChecks = 0;
    await expect(regression.runDeterministicRegression({
      ...baseRunOptions(),
      expectedFixtureManifestSha256: await officialManifestSha256(),
      fixtureDirectory: fixtures,
      resolveFixtureDirectory: undefined,
      verifySnapshot: async () => {
        snapshots += 1;
        if (snapshots === 12) await writeFile(path.join(fixtures, "cer-main.pdf"), "changed-before-write");
      },
      verifyFixtures: async (directory: string) => {
        fixtureChecks += 1;
        return regression.verifyOfficialFixtureSet(directory, { documents });
      },
      spawnCase: async () => successfulChild(snapshots),
      evidenceWriter: writer
    })).rejects.toThrow("REGRESSION_OFFICIAL_FIXTURE_MISMATCH");
    expect(snapshots).toBe(12);
    expect(fixtureChecks).toBe(13);
    expect(writer).not.toHaveBeenCalled();
  });

  it("rejects an identically populated replacement fixture directory", async () => {
    const regression = await regressionPromise;
    const { fixtures, documents, bodies } = await createSyntheticFixtureSet();
    const writer = vi.fn();
    let spawned = 0;
    await expect(regression.runDeterministicRegression({
      ...baseRunOptions(),
      expectedFixtureManifestSha256: await officialManifestSha256(),
      fixtureDirectory: fixtures,
      resolveFixtureDirectory: undefined,
      verifyFixtures: (directory: string) =>
        regression.verifyOfficialFixtureSet(directory, { documents }),
      spawnCase: async () => {
        spawned += 1;
        if (spawned === 1) {
          await rm(fixtures, { recursive: true, force: true });
          await mkdir(fixtures);
          for (const [, filename] of syntheticFixtureFiles) {
            await writeFile(path.join(fixtures, filename), bodies.get(filename)!);
          }
        }
        return successfulChild(spawned);
      },
      evidenceWriter: writer
    })).rejects.toThrow("REGRESSION_OFFICIAL_FIXTURE_DIRECTORY_CHANGED");
    expect(spawned).toBe(1);
    expect(writer).not.toHaveBeenCalled();
  });

  it("uses regression-only evidence terminology in the release implementation and copy", async () => {
    const currentFiles = [
      "scripts/deterministic-regression.mjs",
      "scripts/live-verify.mjs",
      "docs/specs/MH-001-rfp-xray/plan.md",
      "docs/specs/MH-001-rfp-xray/runtime-decision.md",
      "docs/specs/MH-001-rfp-xray/demo-publication-runbook.md",
      "docs/specs/MH-001-rfp-xray/publication-copy-drafts.md",
      "docs/specs/MH-001-rfp-xray/handoff-chief.md",
      "docs/specs/MH-001-rfp-xray/reframing_review.md",
      "docs/specs/MH-001-rfp-xray/handoff-backend.md"
    ];
    const joined = (await Promise.all(currentFiles.map((file) => readFile(path.resolve(file), "utf8")))).join("\n");
    expect(joined).not.toMatch(
      /deterministic_replay|deterministic-replay|ReplayBundle|ReplayCassette|repository_runner_oracle|case_manifest_sha256/i
    );
    await expect(readFile(path.resolve("scripts/deterministic-replay.mjs"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.resolve("tests/unit/deterministic-replay.test.ts"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
