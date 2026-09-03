import { cleanupGate, executeCleanup, type CleanupTarget } from "@/lib/cleanup";
import { sha256Hex } from "@/lib/crypto";
import { transitionRun } from "@/lib/runs/state-machine";
import { PROCESSING_LEASE_MS, type RunStore } from "@/lib/runs/store";
import type { CleanupReceipt, RunRecord } from "@/lib/runs/types";
import { getUploadStorage, stagingBlobPath, type UploadStorage } from "@/lib/storage/uploads";

const AUDIT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const FALLBACK_PROCESSING_LEASE_MS = PROCESSING_LEASE_MS;
const CLEANUP_BATCH_SIZE = 100;

function terminalWinner(
  current: RunRecord["terminalAfterCleanup"],
  requested: "failed" | "expired"
): "failed" | "expired" {
  return current === "expired" || requested === "expired" ? "expired" : "failed";
}

function earlierIso(left: string, right: string): string {
  return new Date(left) <= new Date(right) ? left : right;
}

function quiescenceReached(record: RunRecord, now: Date): boolean {
  return record.processingLeaseExpiresAt === null ||
    new Date(record.processingLeaseExpiresAt) <= now;
}

function releasedProcessMemoryReceipts(record: RunRecord, now: Date): CleanupReceipt[] {
  const alreadyDeleted = new Set(record.cleanupReceipts
    .filter((receipt) => receipt.controlScope === "application" && receipt.status === "deleted")
    .map((receipt) => receipt.resourceId));
  const confirmedAt = now.toISOString();
  return record.cleanupExpectedResourceIds.flatMap((resourceId): CleanupReceipt[] => {
    if (alreadyDeleted.has(resourceId)) return [];
    const resourceKind = resourceId.startsWith("page-text:")
      ? "page_text" as const
      : resourceId.startsWith("parsed:")
        ? "parsed_markdown" as const
        : null;
    if (resourceKind === null) return [];
    return [{
      receiptId: crypto.randomUUID(),
      resourceId,
      resourceKind,
      controlScope: "application",
      status: "deleted",
      attemptedAt: confirmedAt,
      confirmedAt,
      detail: "The revoked worker passed its quiescence deadline; application-only process memory is no longer retained."
    }];
  });
}

function retryableTargets(record: RunRecord, storage: UploadStorage): CleanupTarget[] {
  if (!record.input) return [];
  return record.input.documents.flatMap((document, index): CleanupTarget[] => {
    const stageTarget: CleanupTarget = {
      resourceId: `staged:${record.id}:${index}`,
      resourceKind: "staged_source",
      controlScope: "application",
      remove: () => storage.remove(stagingBlobPath(record.id, index))
    };
    if (document.source.type !== "upload") return [stageTarget];
    const blobPath = document.source.blob_path;
    return [
      {
        resourceId: `blob:${blobPath}`,
        resourceKind: "source_blob",
        controlScope: "application",
        successDetail: "Incoming source content was purged and a verified replay-blocking fence remains until grant expiry.",
        remove: () => storage.purgeIncomingToFence(blobPath, record.id)
      },
      stageTarget
    ];
  });
}

function providerSourceCleanupAuthorized(record: RunRecord, resourceId: string, now: Date) {
  const watchdog = record.sourceCleanupWatchdogs.find((candidate) =>
    candidate.resourceIds.includes(resourceId)
  );
  if (!watchdog || !watchdog.providerCallStartedAt) return true;
  if (watchdog.providerResultCapturedAt) return true;
  return watchdog.sourceAccessExpiresAt !== null &&
    new Date(watchdog.sourceAccessExpiresAt) <= now;
}

function scrubForAudit(record: RunRecord, now: Date): RunRecord {
  return {
    ...record,
    input: null,
    requestHash: null,
    idempotencyKey: null,
    result: null,
    citationReceipts: [],
    manifests: [],
    workflowRunId: null,
    analysisDispatchClaimId: null,
    analysisDispatchClaimedAt: null,
    analysisDispatchStatus: null,
    analysisDispatchUncertainAt: null,
    cleanupRetryClaimId: null,
    cleanupRetryClaimedAt: null,
    cleanupRetryWorkflowRunId: null,
    cleanupRetryDispatchStatus: null,
    cleanupRetryDispatchUncertainAt: null,
    admissionLeaseId: null,
    admissionLeaseExpiresAt: null,
    cleanupExpectedResourceIds: [],
    sourceCleanupWatchdogs: record.sourceCleanupWatchdogs.map((watchdog) => ({
      ...watchdog,
      documentId: `sha256:${sha256Hex(watchdog.documentId)}`,
      resourceIds: watchdog.resourceIds.map((resourceId) =>
        `sha256:${sha256Hex(resourceId)}`
      ),
      watchdogWorkflowRunId: null
    })),
    cleanupReceipts: record.cleanupReceipts.map((receipt) => ({
      ...receipt,
      resourceId: `sha256:${sha256Hex(receipt.resourceId)}`,
      detail: receipt.controlScope === "provider"
        ? "No provider early-delete endpoint was found or verified; the release contract spike observed a seven-day upstream artifact expiry with ZDR disabled."
        : receipt.resourceKind === "source_blob"
          ? "Application-controlled source-content purge and replay fence were confirmed; the identifier was scrubbed."
          : receipt.resourceKind === "page_text" || receipt.resourceKind === "parsed_markdown"
            ? "Application-only process memory was released after worker quiescence; the identifier was scrubbed."
          : "Application-controlled deletion was confirmed; the resource identifier was scrubbed."
    })),
    terminalAfterCleanup: null,
    processingLeaseId: null,
    processingLeaseExpiresAt: null,
    auditExpiresAt: new Date(now.getTime() + AUDIT_RETENTION_MS).toISOString(),
    deletedAt: now.toISOString()
  };
}

export async function cleanupRun(
  record: RunRecord,
  store: RunStore,
  storage: UploadStorage,
  terminal: "failed" | "expired",
  now = new Date(),
  options: { onlyIfProcessingLeaseExpired?: boolean } = {}
): Promise<RunRecord> {
  // Revoke the processing capability before touching external resources. A
  // worker holding the old lease can continue unwinding, but every guarded
  // write is fenced out immediately. Keep the old lease expiry as the point
  // after which its application-only process memory can be considered gone.
  const revoke = (current: RunRecord) => {
    if (current.status === "expired") return current;
    const hadProcessingClaim = current.processingLeaseId !== null;
    const quiescenceDeadline = hadProcessingClaim
      ? current.processingLeaseExpiresAt ?? new Date(now.getTime() + FALLBACK_PROCESSING_LEASE_MS).toISOString()
      : current.processingLeaseExpiresAt;
    const pending = current.status === "cleanup_pending"
      ? current
      : transitionRun(current, "cleanup_pending", now);
    return {
      ...pending,
      cleanupConfirmed: false,
      result: null,
      citationReceipts: [],
      terminalAfterCleanup: terminalWinner(current.terminalAfterCleanup, terminal),
      admissionLeaseId: null,
      admissionLeaseExpiresAt: null,
      processingLeaseId: null,
      processingLeaseExpiresAt: quiescenceDeadline,
      processingFence: current.processingFence + (hadProcessingClaim ? 1 : 0),
      // Make the five-minute maintenance sweep revisit a revoked/crashed
      // worker as soon as its preserved lease deadline has elapsed.
      expiresAt: quiescenceDeadline
        ? earlierIso(current.expiresAt, quiescenceDeadline)
        : current.expiresAt,
      updatedAt: now.toISOString()
    };
  };
  const conditional = options.onlyIfProcessingLeaseExpired
    ? await store.updateIfProcessingLeaseExpired(record.id, now, revoke)
    : null;
  // An explicit store result is required here: a winning heartbeat can leave a
  // fresh lease, while a winning READY transition deliberately leaves a null
  // lease. Neither state may be inferred from the stale record supplied by the
  // watchdog, and neither authorizes any external deletion.
  if (conditional && !conditional.applied) return conditional.record;
  const revoked = conditional?.record ?? await store.update(record.id, revoke);
  if (revoked.status === "expired") return revoked;

  const alreadyDeleted = new Set(revoked.cleanupReceipts
    .filter((receipt) => receipt.controlScope === "application" && receipt.status === "deleted")
    .map((receipt) => receipt.resourceId));
  const revokedWorkerHasQuiesced = quiescenceReached(revoked, now);
  const targets = retryableTargets(revoked, storage)
    // A cancellation or retry-cleanup workflow must not revoke a source URL
    // while an unobserved provider call may still be fetching it. The durable
    // watchdog unlocks these targets on confirmed capture or access expiry.
    .filter((target) => providerSourceCleanupAuthorized(revoked, target.resourceId, now))
    // A still-running worker might recreate a deterministic staging object
    // after an early deletion. Once the lease has elapsed, always delete and
    // reconfirm every durable target instead of trusting historical receipts.
    .filter((target) =>
      !alreadyDeleted.has(target.resourceId) ||
      (revokedWorkerHasQuiesced && target.resourceKind === "staged_source")
    );
  const receipts = await executeCleanup(targets, () => now);
  return store.update(record.id, (current) => {
    if (current.status === "expired") return current;
    const terminalAfterCleanup = terminalWinner(current.terminalAfterCleanup, terminal);
    const externalReceipts = [...current.cleanupReceipts, ...receipts];
    const hasQuiesced = quiescenceReached(current, now);
    const cleanupReceipts = hasQuiesced
      ? [...externalReceipts, ...releasedProcessMemoryReceipts({
          ...current,
          cleanupReceipts: externalReceipts
        }, now)]
      : externalReceipts;
    const durableExpected = current.cleanupExpectedResourceIds.filter(
      (resourceId) => resourceId.startsWith("blob:") || resourceId.startsWith("staged:")
    );
    const durableReconfirmedAfterQuiescence = hasQuiesced && durableExpected.length > 0 &&
      durableExpected.every((resourceId) => {
        const evidence = resourceId.startsWith("staged:") ? receipts : cleanupReceipts;
        return evidence.some((receipt) => receipt.resourceId === resourceId &&
          receipt.controlScope === "application" && receipt.status === "deleted");
      });
    const cleanupConfirmed = durableReconfirmedAfterQuiescence && cleanupGate({
      cleanupExpectedResourceIds: current.cleanupExpectedResourceIds,
      cleanupReceipts
    });
    if (!cleanupConfirmed) {
      const pending = current.status === "cleanup_pending"
        ? current
        : transitionRun(current, "cleanup_pending", now);
      return {
        ...pending,
        cleanupReceipts,
        cleanupConfirmed: false,
        result: null,
        citationReceipts: [],
        terminalAfterCleanup,
        processingLeaseId: null,
        updatedAt: now.toISOString()
      };
    }
    const completed = current.status === terminalAfterCleanup
      ? current
      : transitionRun(current, terminalAfterCleanup, now);
    const cleaned: RunRecord = {
      ...completed,
      cleanupReceipts,
      cleanupConfirmed: true,
      terminalAfterCleanup: null,
      result: null,
      citationReceipts: [],
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
      updatedAt: now.toISOString()
    };
    return terminalAfterCleanup === "expired" ? scrubForAudit(cleaned, now) : cleaned;
  });
}

export async function expireRun(
  record: RunRecord,
  store: RunStore,
  storage: UploadStorage = getUploadStorage(),
  now = new Date()
): Promise<RunRecord> {
  return cleanupRun(record, store, storage, "expired", now);
}

export async function expireDueRuns(
  store: RunStore,
  storage: UploadStorage = getUploadStorage(),
  now = new Date(),
  limit = CLEANUP_BATCH_SIZE,
  options: {
    incomingLimit?: number;
    assertWithinDeadline?: () => void;
  } = {}
) {
  // The store performs the due/stale filtering and applies a hard batch
  // limit. This keeps maintenance work proportional to actionable records
  // instead of loading the entire run table into application memory.
  options.assertWithinDeadline?.();
  const due = await store.listCleanupCandidates(
    now,
    Math.min(Math.max(Math.trunc(limit), 1), CLEANUP_BATCH_SIZE)
  );
  const results: RunRecord[] = [];
  for (const record of due) {
    options.assertWithinDeadline?.();
    if (record.status === "expired") {
      if (record.auditExpiresAt && new Date(record.auditExpiresAt) <= now) await store.remove(record.id);
      options.assertWithinDeadline?.();
      continue;
    }
    results.push(record.status === "cleanup_pending"
      ? await cleanupRun(
          record,
          store,
          storage,
          record.terminalAfterCleanup ?? "expired",
          now
        )
      : await expireRun(record, store, storage, now));
    options.assertWithinDeadline?.();
  }
  options.assertWithinDeadline?.();
  await storage.sweepExpiredIncoming(
    now,
    Math.min(Math.max(Math.trunc(options.incomingLimit ?? 100), 1), 100)
  );
  options.assertWithinDeadline?.();
  return results;
}
