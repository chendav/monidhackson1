import { describe, expect, it } from "vitest";
import { runRecordToRow, runRowToRecord, type RunRow } from "@/db/neon-store";
import {
  MAX_RECORD_AUTHORITY_RECEIPT_BYTES,
  unresolvedRecordAuthority
} from "@/lib/analysis/record-authority";
import {
  createRecordAuthorityAudit,
  RecordAuthorityAuditSchema
} from "@/lib/runs/record-authority-audit";
import { newRunRecord } from "@/lib/runs/store";
import { SubmissionAdjudicationAuditSchema } from "@/lib/runs/submission-adjudication-audit";
// @ts-expect-error The operator CLI is intentionally plain ESM for direct Node execution.
import { formatRecordAuthorityAudit, readRecordAuthorityAudit, runCli } from "../../scripts/read-record-authority-audit.mjs";

const runId = "00000000-0000-4000-8000-000000000001";

function run() {
  return newRunRecord({
    id: runId,
    ownerId: "guest:audit",
    quotaKey: "ip:audit",
    input: {
      documents: [{
        role: "base",
        source: {
          type: "upload",
          blob_path: "incoming/audit.pdf",
          sha256: "a".repeat(64),
          size_bytes: 123,
          filename: "audit.pdf"
        }
      }]
    },
    idempotencyKey: null,
    reservedMicroUsd: 499_500,
    now: new Date("2026-09-04T12:00:00Z")
  });
}

describe("record authority audit persistence", () => {
  it("stores only the strict sanitized allowlist", () => {
    const manifest = unresolvedRecordAuthority("fixture_incomplete");
    const audit = createRecordAuthorityAudit(manifest, new Date("2026-09-04T12:01:00Z"));
    expect(Object.keys(audit).toSorted()).toEqual([
      "complete",
      "counters",
      "integrity_complete",
      "manifest_digest",
      "package_veto",
      "receipt_byte_length",
      "receipt_limit_bytes",
      "record_count",
      "recorded_at",
      "version"
    ]);
    expect(audit).toMatchObject({
      version: 5,
      manifest_digest: manifest.record_manifest_digest,
      receipt_byte_length: manifest.receipt_byte_length,
      receipt_limit_bytes: MAX_RECORD_AUTHORITY_RECEIPT_BYTES,
      record_count: 0,
      complete: false,
      integrity_complete: false,
      package_veto: false,
      recorded_at: "2026-09-04T12:01:00.000Z"
    });
    expect(audit.version === 5 && audit.counters).toEqual({
      relevance: { s: 0, n: 0, u: 0, mixed: 0, missing: 0 },
      source_binding: { unlocated: 0, exact_bound: 0, coverage_gap: 0,
        relation_gap: 0, relation_conflict: 0 },
      semantic_crosscheck: { consistent: 0, disagrees: 0, unknown: 0 },
      publication: { verified: 0, discarded: 0 },
      publication_reason: { verified: 0, source_unlocated: 0, source_coverage_gap: 0,
        source_relation_gap: 0, source_relation_conflict: 0, semantic_unknown: 0,
        semantic_disagreement: 0, receipt_integrity: 0 },
      submission_veto_reason: { exact_submission_coverage_gap: 0,
        exact_submission_relation_gap: 0, exact_submission_relation_conflict: 0,
        exact_non_submission_overlap: 0, exact_semantic_uncertainty: 0,
        exact_relevance_disagreement: 0 }
    });
    const serialized = JSON.stringify(audit);
    for (const forbidden of ["source_text", "evidence_quote", "record_id", "page", "offset",
      "source_url", "private_output"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(RecordAuthorityAuditSchema.safeParse({
      ...audit,
      evidence_quote: "private source text"
    }).success).toBe(false);
    expect(() => formatRecordAuthorityAudit(runId, {
      ...audit,
      source_url: "https://private.invalid/tender.pdf"
    })).toThrow();
    if (audit.version !== 5) throw new Error("expected_v5_audit");
    const inconsistent = structuredClone(audit);
    inconsistent.counters.relevance.s = 1;
    expect(RecordAuthorityAuditSchema.safeParse(inconsistent).success).toBe(false);
    expect(() => formatRecordAuthorityAudit(runId, inconsistent)).toThrow();
  });

  it("turns a mutated receipt into an explicit incomplete audit", () => {
    const manifest = unresolvedRecordAuthority("fixture_incomplete");
    const audit = createRecordAuthorityAudit({
      ...manifest,
      record_manifest_digest: "f".repeat(64)
    }, new Date("2026-09-04T12:01:00Z"));
    expect(audit.complete).toBe(false);
    expect(audit.manifest_digest).not.toBe("f".repeat(64));

    const legacy = createRecordAuthorityAudit({
      ...manifest,
      version: 1,
      record_manifest_digest: "1".repeat(64)
    }, new Date("2026-09-04T12:02:00Z"));
    expect(legacy).toMatchObject({
      version: 5, complete: false, integrity_complete: false,
      package_veto: false, record_count: 0
    });
    const legacyAudit = {
      manifest_digest: audit.manifest_digest,
      receipt_byte_length: audit.receipt_byte_length,
      receipt_limit_bytes: 262_144,
      record_count: audit.record_count,
      complete: audit.complete,
      recorded_at: audit.recorded_at
    };
    expect(formatRecordAuthorityAudit(runId, {
      ...legacyAudit,
      version: 1
    }).version).toBe(1);
    expect(formatRecordAuthorityAudit(runId, {
      ...legacyAudit,
      version: 2
    }).version).toBe(2);
    const historicalV3 = {
      version: 3,
      ...legacyAudit,
      counters: {
        relevance: { s: 0, n: 0, u: 0, missing: 0 },
        source_binding: { unlocated: 0, exact_bound: 0, coverage_gap: 0,
          relation_gap: 0, relation_conflict: 0 },
        semantic_crosscheck: { consistent: 0, disagrees: 0, unknown: 0 },
        publication: { verified: 0, discarded: 0 },
        publication_reason: { verified: 0, source_unlocated: 0, source_coverage_gap: 0,
          source_relation_gap: 0, source_relation_conflict: 0, semantic_unknown: 0,
          semantic_disagreement: 0, receipt_integrity: 0 },
        submission_veto_reason: { exact_submission_coverage_gap: 0,
          exact_submission_relation_gap: 0, exact_submission_relation_conflict: 0,
          exact_non_submission_overlap: 0, exact_semantic_uncertainty: 0,
          exact_relevance_disagreement: 0 }
      }
    };
    expect(formatRecordAuthorityAudit(runId, historicalV3).version).toBe(3);
    const historicalV4 = {
      ...audit,
      version: 4,
      receipt_byte_length: 262_144,
      receipt_limit_bytes: 262_144
    };
    expect(RecordAuthorityAuditSchema.safeParse(historicalV4).success).toBe(true);
    expect(formatRecordAuthorityAudit(runId, historicalV4).version).toBe(4);
    const oversizedV4 = { ...historicalV4, receipt_byte_length: 262_145 };
    expect(RecordAuthorityAuditSchema.safeParse(oversizedV4).success).toBe(false);
    expect(() => formatRecordAuthorityAudit(runId, oversizedV4)).toThrow();
    const highByteV5 = { ...audit, receipt_byte_length: 269_326 };
    expect(RecordAuthorityAuditSchema.safeParse(highByteV5).success).toBe(true);
    expect(formatRecordAuthorityAudit(runId, highByteV5)).toMatchObject({
      version: 5,
      receipt_byte_length: 269_326,
      receipt_limit_bytes: 524_288
    });
    expect(JSON.stringify(formatRecordAuthorityAudit(runId, historicalV3)))
      .not.toContain(runId);
  });

  it("round-trips the nullable audit through the Neon row mapping", () => {
    const original = run();
    expect(original.recordAuthorityAudit).toBeNull();
    expect(original.submissionAdjudicationAudit).toBeNull();
    original.recordAuthorityAudit = createRecordAuthorityAudit(
      unresolvedRecordAuthority("fixture_incomplete"),
      new Date("2026-09-04T12:01:00Z")
    );
    original.submissionAdjudicationAudit = SubmissionAdjudicationAuditSchema.parse({
      version: 1,
      ledger_digest: "b".repeat(64),
      expected_candidate_count: 0,
      verified_candidate_count: 0,
      expected_page_count: 0,
      covered_page_count: 0,
      expected_source_fragment_count: 0,
      verified_source_fragment_count: 0,
      expected_batch_count: 0,
      verified_batch_count: 0,
      unresolved_batch_count: 0,
      complete: true,
      resolution_status: "none",
      unresolved_reason_counts: Object.fromEntries([
        "capacity", "incomplete_page_coverage", "invalid_amendment_metadata", "missing_batch",
        "duplicate_batch", "unknown_batch", "ledger_digest_mismatch", "batch_manifest_mismatch",
        "missing_candidate", "duplicate_candidate", "unknown_candidate", "sha_mismatch",
        "page_mismatch", "channel_mismatch", "offset_mismatch", "quote_too_long",
        "condition_mismatch", "low_confidence", "semantic_uncertainty", "overlap_disagreement",
        "prompt_injection", "draft_disagreement"
      ].map((reason) => [reason, 0])),
      recorded_at: "2026-09-04T12:01:00.000Z"
    });
    const row = runRecordToRow(original);
    expect(row.recordAuthorityAudit).toEqual(original.recordAuthorityAudit);
    expect(row.submissionAdjudicationAudit).toEqual(original.submissionAdjudicationAudit);
    const restored = runRowToRecord(row as RunRow);
    expect(restored.recordAuthorityAudit).toEqual(original.recordAuthorityAudit);
    expect(restored.submissionAdjudicationAudit).toEqual(original.submissionAdjudicationAudit);
  });

  it("uses a bound run id and fails closed when no audit row exists", async () => {
    let boundId: unknown;
    const factory = () => async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      boundId = values[0];
      return [];
    };
    await expect(readRecordAuthorityAudit(runId, "postgres://redacted", factory))
      .rejects.toThrow("record_authority_audit_not_found");
    expect(boundId).toBe(runId);
    await expect(readRecordAuthorityAudit("not-a-uuid", "postgres://redacted", factory))
      .rejects.toThrow();

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli([runId], {
      databaseUrl: "postgres://redacted",
      reader: async () => { throw new Error("record_authority_audit_not_found"); },
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line)
    });
    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(["record_authority_audit_not_found"]);
  });

  it("prints only the sanitized audit and never echoes the raw run id", async () => {
    const audit = createRecordAuthorityAudit(
      unresolvedRecordAuthority("fixture_incomplete"),
      new Date("2026-09-04T12:01:00Z")
    );
    const stdout: string[] = [];
    const exitCode = await runCli([runId], {
      databaseUrl: "postgres://redacted",
      reader: async (id: string) => formatRecordAuthorityAudit(id, audit),
      stdout: (line: string) => stdout.push(line),
      stderr: () => {}
    });
    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(1);
    expect(stdout[0]).not.toContain(runId);
    expect(JSON.parse(stdout[0]!)).toEqual(audit);
  });
});
