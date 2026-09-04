import { describe, expect, it } from "vitest";
import type { VerifiedSubmissionAdjudication } from "@/lib/analysis/submission-channel";
import {
  SubmissionAdjudicationAuditSchema,
  createSubmissionAdjudicationAudit
} from "@/lib/runs/submission-adjudication-audit";
// @ts-expect-error The operator CLI is intentionally plain ESM for direct Node execution.
import { formatSubmissionAdjudicationAudit, readSubmissionAdjudicationAudit, runCli } from "../../scripts/read-submission-adjudication-audit.mjs";

const runId = "018f47a2-9f21-7d21-a06c-0a9ecf8d2a31";
const digest = "a".repeat(64);

function artifact(overrides: Partial<VerifiedSubmissionAdjudication> = {}): VerifiedSubmissionAdjudication {
  return {
    ledger_version: "submission-ledger-v2",
    ledger_digest: digest,
    expected_candidate_count: 1,
    verified_candidate_count: 1,
    expected_page_count: 1,
    covered_page_count: 1,
    expected_source_fragment_count: 1,
    verified_source_fragment_count: 1,
    expected_batch_count: 1,
    verified_batch_count: 1,
    complete: true,
    unresolved_reasons: [],
    records: [{
      candidate_id: "private-candidate",
      document_sha256: "b".repeat(64),
      pdf_page_1based: 1,
      page_text_sha256: "c".repeat(64),
      disposition: "verified",
      reason: null,
      relations: [{
        occurrence_key: "private-occurrence",
        document_sha256: "b".repeat(64),
        role: "base",
        amendment_number: null,
        pdf_page_1based: 1,
        printed_page_label: "1",
        page_text_sha256: "c".repeat(64),
        section: "Submission",
        relation_start_utf16: 0,
        relation_end_utf16: 10,
        subject_scope: "whole_bid",
        modality: "required",
        channel: "email",
        has_condition_or_scope: false,
        condition_or_scope_sha256: null,
        confidence: 0.99,
        evidence_quote: "private",
        evidence_quote_sha256: "d".repeat(64)
      }]
    }],
    ...overrides
  };
}

describe("submission adjudication private audit", () => {
  it("persists only bounded counts, enums, digest, and time", () => {
    const audit = createSubmissionAdjudicationAudit(
      artifact(),
      new Date("2026-09-04T12:00:00.000Z")
    );
    expect(audit).toMatchObject({
      version: 2,
      expected_candidate_count: 1,
      verified_candidate_count: 1,
      expected_batch_count: 1,
      verified_batch_count: 1,
      unresolved_batch_count: 0,
      complete: true,
      resolution_status: "unique"
    });
    expect(Object.values(audit.unresolved_reason_counts).reduce((sum, value) => sum + value, 0))
      .toBe(0);
    const serialized = JSON.stringify(audit);
    for (const forbidden of ["private-candidate", "private-occurrence", "\"private\"", "page_text",
      "relation_start_utf16", "source_url", "evidence_quote", "record_id"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(SubmissionAdjudicationAuditSchema.parse(audit)).toEqual(audit);
    expect(formatSubmissionAdjudicationAudit(runId, audit)).toEqual(audit);
  });

  it("records exact fixed unresolved reasons and batch completeness", () => {
    const failed = artifact({
      verified_candidate_count: 0,
      verified_source_fragment_count: 0,
      verified_batch_count: 0,
      complete: false,
      unresolved_reasons: ["offset_mismatch"],
      records: [{ ...artifact().records[0]!, disposition: "unresolved",
        reason: "offset_mismatch", relations: [] }]
    });
    const audit = createSubmissionAdjudicationAudit(failed);
    expect(audit).toMatchObject({
      complete: false,
      resolution_status: "unresolved",
      unresolved_batch_count: 1,
      unresolved_reason_counts: { offset_mismatch: 1 }
    });
    expect(() => SubmissionAdjudicationAuditSchema.parse({
      ...audit,
      candidate_id: "forbidden"
    })).toThrow();
  });

  it("strictly reads historical v1 and current v2 without exposing the run ID", () => {
    const current = createSubmissionAdjudicationAudit(artifact());
    const historicalReasons = Object.fromEntries(Object.entries(current.unresolved_reason_counts)
      .filter(([reason]) => reason !== "ownership_mismatch"));
    const historical = {
      ...current,
      version: 1 as const,
      unresolved_reason_counts: historicalReasons
    };
    expect(formatSubmissionAdjudicationAudit(runId, historical)).toEqual(historical);
    expect(formatSubmissionAdjudicationAudit(runId, current)).toEqual(current);
    expect(JSON.stringify(formatSubmissionAdjudicationAudit(runId, current)))
      .not.toContain(runId);
    expect(() => formatSubmissionAdjudicationAudit(runId, {
      ...historical,
      unresolved_reason_counts: {
        ...historical.unresolved_reason_counts,
        ownership_mismatch: 0
      }
    })).toThrow();
  });

  it("binds the operator query and fails closed for absent rows", async () => {
    let bound: unknown;
    const factory = () => async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      bound = values[0];
      return [];
    };
    await expect(readSubmissionAdjudicationAudit(runId, "postgres://redacted", factory))
      .rejects.toThrow("submission_adjudication_audit_not_found");
    expect(bound).toBe(runId);
    const stderr: string[] = [];
    expect(await runCli([runId], { reader: async () => {
      throw new Error("submission_adjudication_audit_not_found");
    }, stderr: (line: string) => stderr.push(line) })).toBe(2);
    expect(stderr).toEqual(["submission_adjudication_audit_not_found"]);
  });

  it("prints only the strict audit allowlist on a successful operator read", async () => {
    const audit = createSubmissionAdjudicationAudit(artifact());
    const stdout: string[] = [];
    expect(await runCli([runId], {
      reader: async () => audit,
      stdout: (line: string) => stdout.push(line)
    })).toBe(0);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0]!)).toEqual(audit);
    expect(stdout[0]).not.toContain(runId);
  });
});
