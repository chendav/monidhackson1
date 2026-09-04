import { describe, expect, it } from "vitest";
import type { PresignUploadResponse } from "@/contracts";
import { LocalDeterministicModel } from "@/lib/analysis/local-model";
import {
  RecordAuthorityEnvelopeSchema,
  recordsIn,
  verifyRecordAuthorities
} from "@/lib/analysis/record-authority";
import {
  SubmissionBatchAdjudicationSchema,
  verifySubmissionAdjudication,
  type SubmissionBatchBinding
} from "@/lib/analysis/submission-channel";
import { getConfig } from "@/lib/config";
import { sha256Hex, stableJson } from "@/lib/crypto";
import { processRun } from "@/lib/pipeline";
import type { ModelDocumentInput } from "@/lib/providers/openai";
import { expireDueRuns, expireRun } from "@/lib/runs/expiry";
import { InMemoryRunStore } from "@/lib/runs/store";
import { InMemoryBudgetGuard } from "@/lib/security/budget";
import type { UploadStorage } from "@/lib/storage/uploads";
import { makeMinimalPdf } from "../unit/minimal-pdf";

class AuditStorage implements UploadStorage {
  constructor(private readonly bytes: Uint8Array) {}
  async presign(): Promise<PresignUploadResponse> { throw new Error("not used"); }
  async claimIncoming(): Promise<void> {}
  async read(): Promise<Uint8Array> { return this.bytes.slice(); }
  async stage(): Promise<void> {}
  async temporaryReadUrl(): Promise<string> { throw new Error("not used"); }
  async purgeIncomingToFence(): Promise<void> {}
  async remove(): Promise<void> {}
  async sweepExpiredIncoming(): Promise<string[]> { return []; }
}

describe("record authority pipeline audit", () => {
  it("persists the actual verified nonempty receipt measurement after cleanup", async () => {
    const bytes = makeMinimalPdf(["Invoices are payable within 30 days."]);
    const sha = sha256Hex(bytes);
    const store = new InMemoryRunStore();
    const record = (await store.create({
      ownerId: "guest:authority-audit",
      quotaKey: "ip:authority-audit",
      input: {
        documents: [{
          role: "base",
          source: {
            type: "upload",
            blob_path: `incoming/test/${sha}.pdf`,
            sha256: sha,
            size_bytes: bytes.byteLength,
            filename: "authority-audit.pdf"
          }
        }]
      },
      idempotencyKey: null,
      reservedMicroUsd: 499_500
    })).record;
    const config = getConfig({
      NODE_ENV: "test",
      SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough"
    });
    const local = new LocalDeterministicModel();
    let actualReceiptBytes = -1;
    let actualReceiptDigest = "";
    let actualRecordCount = -1;
    const model = {
      async extract(documents: ModelDocumentInput[]) {
        const extracted = await local.extract(documents);
        const ledger = documents.find((document) => document.submission_ledger)
          ?.submission_ledger;
        if (!ledger) throw new Error("missing fixture ledger");
        const sourceDocuments = documents.map((document) => {
          if (!document.citation_document) throw new Error("missing fixture citation document");
          return {
            ...document.citation_document,
            role: document.role,
            amendmentNumber: document.amendment_number
          };
        });
        const binding: SubmissionBatchBinding = {
          batch_id: sha256Hex(stableJson({ fixture: "pipeline-authority-audit" })),
          ledger_digest: ledger.ledger_digest,
          ordered_candidate_ids: ledger.candidates.map((candidate) => candidate.candidate_id),
          ordered_source_fragment_ids: documents.map((document, index) =>
            `${index}:${document.document_sha256}`
          ),
          prompt_injection_tainted: false
        };
        const response = SubmissionBatchAdjudicationSchema.parse({
          batch_id: binding.batch_id,
          ledger_digest: binding.ledger_digest,
          ordered_candidate_ids: binding.ordered_candidate_ids,
          ordered_source_fragment_ids: binding.ordered_source_fragment_ids,
          coverage_units: ledger.candidates.map((candidate) => ({
            candidate_id: candidate.candidate_id,
            document_sha256: candidate.document_sha256,
            pdf_page_1based: candidate.pdf_page_1based,
            coverage: "complete",
            relations: []
          }))
        });
        const submissionAdjudication = verifySubmissionAdjudication({
          ledger,
          bindings: [binding],
          responses: [response],
          packingComplete: true
        });
        const recordAuthority = verifyRecordAuthorities({
          batches: [{
            binding,
            draft: extracted.analysis,
            authority: RecordAuthorityEnvelopeSchema.parse({
              v: 1,
              r: recordsIn(extracted.analysis).map(({ kind, ordinal }) =>
                [kind, ordinal, "n"]
              )
            })
          }],
          ledger,
          submission: submissionAdjudication,
          documents: sourceDocuments,
          mergedDraft: extracted.analysis
        });
        expect(recordAuthority.complete).toBe(true);
        expect(recordAuthority.records.length).toBeGreaterThan(0);
        actualReceiptBytes = recordAuthority.receipt_byte_length;
        actualReceiptDigest = recordAuthority.record_manifest_digest;
        actualRecordCount = recordAuthority.records.length;
        return { ...extracted, submissionAdjudication, recordAuthority };
      },
      answer: local.answer.bind(local)
    };

    const storage = new AuditStorage(bytes);
    const completed = await processRun(record.id, {
      store,
      uploadStorage: storage,
      budget: new InMemoryBudgetGuard(config),
      config,
      model
    });

    expect(completed.cleanupConfirmed).toBe(true);
    expect(completed.recordAuthorityAudit).toMatchObject({
      version: 4,
      manifest_digest: actualReceiptDigest,
      receipt_byte_length: actualReceiptBytes,
      receipt_limit_bytes: 262_144,
      record_count: actualRecordCount,
      complete: true
    });
    expect(completed.recordAuthorityAudit?.version === 4 &&
      completed.recordAuthorityAudit.counters.publication.verified).toBeGreaterThan(0);
    if (completed.recordAuthorityAudit?.version !== 4) throw new Error("expected_v4_audit");
    const counters = completed.recordAuthorityAudit.counters;
    expect(Object.values(counters.relevance).reduce((sum, count) => sum + count, 0))
      .toBe(actualRecordCount);
    expect(Object.values(counters.source_binding).reduce((sum, count) => sum + count, 0))
      .toBe(actualRecordCount);
    expect(Object.values(counters.semantic_crosscheck).reduce((sum, count) => sum + count, 0))
      .toBe(actualRecordCount);
    expect(Object.values(counters.publication).reduce((sum, count) => sum + count, 0))
      .toBe(actualRecordCount);
    expect((await store.get(record.id))?.recordAuthorityAudit)
      .toEqual(completed.recordAuthorityAudit);
    expect(completed.submissionAdjudicationAudit).toMatchObject({
      version: 2,
      complete: true,
      expected_batch_count: 1,
      verified_batch_count: 1,
      unresolved_batch_count: 0
    });
    expect((await store.get(record.id))?.submissionAdjudicationAudit)
      .toEqual(completed.submissionAdjudicationAudit);

    const expiredAt = new Date(new Date(completed.expiresAt).getTime() + 1);
    const expired = await expireRun(completed, store, storage, expiredAt);
    expect(expired.status).toBe("expired");
    expect(expired.result).toBeNull();
    expect(expired.recordAuthorityAudit).toEqual(completed.recordAuthorityAudit);
    expect(expired.submissionAdjudicationAudit).toEqual(completed.submissionAdjudicationAudit);
    expect(expired.auditExpiresAt).not.toBeNull();
    await expireDueRuns(
      store,
      storage,
      new Date(new Date(expired.auditExpiresAt!).getTime() + 1)
    );
    expect(await store.get(record.id)).toBeUndefined();
  });

  it("records an explicit incomplete audit when the model receipt is missing", async () => {
    const bytes = makeMinimalPdf(["Ordinary contractual statement."]);
    const sha = sha256Hex(bytes);
    const store = new InMemoryRunStore();
    const record = (await store.create({
      ownerId: "guest:missing-authority-audit",
      quotaKey: "ip:missing-authority-audit",
      input: {
        documents: [{ role: "base", source: {
          type: "upload", blob_path: `incoming/test/${sha}.pdf`, sha256: sha,
          size_bytes: bytes.byteLength, filename: "missing-authority.pdf"
        } }]
      },
      idempotencyKey: null,
      reservedMicroUsd: 499_500
    })).record;
    const config = getConfig({
      NODE_ENV: "test",
      SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough"
    });
    const local = new LocalDeterministicModel();
    const model = {
      async extract(input: ModelDocumentInput[]) {
        const extraction = await local.extract(input);
        return { ...extraction, recordAuthority: undefined };
      },
      answer: local.answer.bind(local)
    };
    const completed = await processRun(record.id, {
      store,
      uploadStorage: new AuditStorage(bytes),
      budget: new InMemoryBudgetGuard(config),
      config,
      model
    });
    expect(completed.cleanupConfirmed).toBe(true);
    expect(completed.recordAuthorityAudit).toMatchObject({
      complete: false,
      record_count: 0,
      receipt_limit_bytes: 262_144
    });
    expect(completed.result?.summary.submission_method).toBeNull();
  });
});
