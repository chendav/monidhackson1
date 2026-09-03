import { cleanupGate, executeCleanup, type CleanupTarget } from "@/lib/cleanup";
import type { CostEvent } from "@/contracts";
import { AppError } from "@/lib/errors";
import { assertDurableCommitmentFits } from "@/lib/runs/paid-cost-ledger";
import { cleanupRun } from "@/lib/runs/expiry";
import { LEASED_RUN_STATUSES, type RunStore } from "@/lib/runs/store";
import type {
  CleanupReceipt,
  RunRecord,
  SourceCleanupWatchdog
} from "@/lib/runs/types";
import { stagingBlobPath, type UploadStorage } from "@/lib/storage/uploads";

export const SOURCE_CLEANUP_WATCHDOG_POLL_MS = 10_000;
export const SOURCE_CLEANUP_CAPTURE_SLA_MS = 60_000;

interface ProcessingClaim {
  leaseId: string;
  fence: number;
}

function watchdogById(record: RunRecord, registrationId: string) {
  return record.sourceCleanupWatchdogs.find(
    (watchdog) => watchdog.registrationId === registrationId
  );
}

function updateWatchdog(
  record: RunRecord,
  registrationId: string,
  mutate: (watchdog: SourceCleanupWatchdog) => SourceCleanupWatchdog
): RunRecord {
  let found = false;
  const sourceCleanupWatchdogs = record.sourceCleanupWatchdogs.map((watchdog) => {
    if (watchdog.registrationId !== registrationId) return watchdog;
    found = true;
    return mutate(watchdog);
  });
  if (!found) {
    throw new AppError("ANALYSIS_INCOMPLETE", "The source cleanup watchdog was not found.", {
      httpStatus: 409,
      retryable: false
    });
  }
  return { ...record, sourceCleanupWatchdogs };
}

function sanitizedResourceIds(
  runId: string,
  documentIndex: number,
  resourceIds: string[]
) {
  const unique = [...new Set(resourceIds)];
  const expectedStage = `staged:${runId}:${documentIndex}`;
  if (!unique.includes(expectedStage)) {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      "The cleanup watchdog must own the document staging resource.",
      { retryable: false }
    );
  }
  if (unique.some((resourceId) =>
    resourceId !== expectedStage && !resourceId.startsWith("blob:incoming/")
  )) {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      "The cleanup watchdog received an invalid application resource identifier.",
      { retryable: false }
    );
  }
  return unique;
}

export async function armSourceCleanupWatchdog(input: {
  store: RunStore;
  runId: string;
  documentIndex: number;
  documentId: string;
  resourceIds: string[];
  claim: ProcessingClaim;
  now: Date;
}): Promise<SourceCleanupWatchdog> {
  const resourceIds = sanitizedResourceIds(
    input.runId,
    input.documentIndex,
    input.resourceIds
  );
  let armed: SourceCleanupWatchdog | undefined;
  await input.store.update(input.runId, (record) => {
    const existing = record.sourceCleanupWatchdogs.find(
      (watchdog) => watchdog.documentIndex === input.documentIndex
    );
    if (existing) {
      if (existing.providerCallStartedAt !== null) {
        throw new AppError(
          "ANALYSIS_INCOMPLETE",
          "A paid provider attempt for this document has already started.",
          { retryable: false }
        );
      }
      armed = {
        ...existing,
        documentId: input.documentId,
        resourceIds
      };
      return {
        ...record,
        sourceCleanupWatchdogs: record.sourceCleanupWatchdogs.map((watchdog) =>
          watchdog.registrationId === existing.registrationId ? armed! : watchdog
        ),
        updatedAt: input.now.toISOString()
      };
    }
    armed = {
      registrationId: crypto.randomUUID(),
      documentIndex: input.documentIndex,
      documentId: input.documentId,
      resourceIds,
      status: "armed",
      registeredAt: input.now.toISOString(),
      watchdogScheduledAt: null,
      watchdogWorkflowRunId: null,
      providerCallStartedAt: null,
      sourceAccessExpiresAt: null,
      providerResultCapturedAt: null,
      providerResultIdSha256: null,
      cleanupLastAttemptAt: null,
      cleanupConfirmedAt: null,
      cleanupAttempts: 0,
      cancelledAt: null
    };
    return {
      ...record,
      sourceCleanupWatchdogs: [...record.sourceCleanupWatchdogs, armed],
      updatedAt: input.now.toISOString()
    };
  }, input.claim);
  return structuredClone(armed!);
}

export async function recordSourceCleanupWatchdogScheduled(input: {
  store: RunStore;
  runId: string;
  registrationId: string;
  workflowRunId: string | null;
  claim: ProcessingClaim;
  now: Date;
}) {
  return input.store.update(input.runId, (record) => ({
    ...updateWatchdog(record, input.registrationId, (watchdog) => ({
      ...watchdog,
      watchdogScheduledAt: watchdog.watchdogScheduledAt ?? input.now.toISOString(),
      watchdogWorkflowRunId: watchdog.watchdogWorkflowRunId ?? input.workflowRunId
    })),
    updatedAt: input.now.toISOString()
  }), input.claim);
}

export async function markSourceProviderCallStarted(input: {
  store: RunStore;
  runId: string;
  registrationId: string;
  claim: ProcessingClaim;
  sourceAccessExpiresAt: Date;
  reservedMicroUsd: number;
  totalPlannedMonidAttempts: number;
  remainingOpenAiCommitmentMicroUsd: number;
  maximumRunCostMicroUsd: number;
  now: Date;
}) {
  if (!Number.isSafeInteger(input.reservedMicroUsd) || input.reservedMicroUsd < 0) {
    throw new AppError(
      "BUDGET_EXCEEDED",
      "The provider attempt reserve is invalid.",
      { retryable: false }
    );
  }
  if (input.sourceAccessExpiresAt <= input.now) {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      "The parser source-access window must expire after the provider call starts.",
      { retryable: false }
    );
  }
  if (!Number.isSafeInteger(input.totalPlannedMonidAttempts) || input.totalPlannedMonidAttempts < 1) {
    throw new AppError("BUDGET_EXCEEDED", "The planned Monid attempt count is invalid.", {
      retryable: false
    });
  }
  return input.store.update(input.runId, (record) => {
    const watchdog = watchdogById(record, input.registrationId);
    if (!watchdog?.watchdogScheduledAt) {
      throw new AppError(
        "ANALYSIS_INCOMPLETE",
        "The paid provider call cannot start before its cleanup watchdog is scheduled.",
        { retryable: false }
      );
    }
    if (record.costs.some((cost) => cost.attempt_id === input.registrationId)) {
      throw new AppError(
        "ANALYSIS_INCOMPLETE",
        "The paid Monid attempt was already recorded; replay was blocked.",
        { httpStatus: 409, retryable: false }
      );
    }
    const costs = [...record.costs, {
      attempt_id: input.registrationId,
      provider: "monid" as const,
      operation: "context_dev_parse",
      status: "pending" as const,
      actual_micro_usd: null,
      estimated_micro_usd: input.reservedMicroUsd,
      latency_ms: 0,
      retry_of: null,
      cost_provenance: null
    }];
    const startedMonidAttempts = new Set(costs
      .filter((event) => event.provider === "monid" && event.attempt_id)
      .map((event) => event.attempt_id!)).size;
    if (startedMonidAttempts > input.totalPlannedMonidAttempts) {
      throw new AppError("BUDGET_EXCEEDED", "The paid Monid attempt plan was exceeded.", {
        retryable: false
      });
    }
    const costMicroUsd = costs.reduce(
      (total, event) => total + (event.actual_micro_usd ?? event.estimated_micro_usd ?? 0),
      0
    );
    assertDurableCommitmentFits({
      costMicroUsd,
      remainingCommitmentMicroUsd:
        (input.totalPlannedMonidAttempts - startedMonidAttempts) * input.reservedMicroUsd +
        input.remainingOpenAiCommitmentMicroUsd,
      reservedMicroUsd: record.reservedMicroUsd,
      maximumRunCostMicroUsd: input.maximumRunCostMicroUsd
    });
    return {
      ...updateWatchdog(record, input.registrationId, (current) => ({
        ...current,
        status: current.status === "armed" ? "provider_call_started" : current.status,
        providerCallStartedAt: current.providerCallStartedAt ?? input.now.toISOString(),
        sourceAccessExpiresAt:
          current.sourceAccessExpiresAt ?? input.sourceAccessExpiresAt.toISOString()
      })),
      paidProviderAttemptStartedAt:
        record.paidProviderAttemptStartedAt ?? input.now.toISOString(),
      costs,
      costMicroUsd,
      updatedAt: input.now.toISOString()
    };
  }, input.claim);
}

export async function markSourceProviderResultCaptured(input: {
  store: RunStore;
  runId: string;
  registrationId: string;
  providerResultIdSha256: string | null;
  parsedResourceId?: string;
  costEvent?: CostEvent;
  claim: ProcessingClaim;
  now: Date;
}) {
  if (
    input.providerResultIdSha256 !== null &&
    !/^[a-f0-9]{64}$/i.test(input.providerResultIdSha256)
  ) {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      "The provider result identifier must be stored only as a SHA-256 digest.",
      { retryable: false }
    );
  }
  return input.store.update(input.runId, (record) => {
    const watchdog = watchdogById(record, input.registrationId);
    if (!watchdog?.providerCallStartedAt) {
      throw new AppError(
        "ANALYSIS_INCOMPLETE",
        "A provider result cannot be captured before its paid call is recorded.",
        { retryable: false }
      );
    }
    const cleanupExpectedResourceIds = input.parsedResourceId
      ? [...new Set([...record.cleanupExpectedResourceIds, input.parsedResourceId])]
      : record.cleanupExpectedResourceIds;
    if (input.costEvent?.attempt_id !== undefined &&
      input.costEvent.attempt_id !== input.registrationId) {
      throw new AppError(
        "ANALYSIS_INCOMPLETE",
        "The provider cost event does not match its paid attempt.",
        { retryable: false }
      );
    }
    if (input.costEvent && !record.costs.some((event) =>
      event.attempt_id === input.registrationId && event.status === "pending"
    )) {
      throw new AppError(
        "ANALYSIS_INCOMPLETE",
        "The provider outcome cannot settle an unrecorded paid attempt.",
        { retryable: false }
      );
    }
    const costs = input.costEvent
      ? record.costs.map((event) =>
          event.attempt_id === input.registrationId ? input.costEvent! : event
        )
      : record.costs;
    return {
      ...updateWatchdog(record, input.registrationId, (current) => ({
        ...current,
        status: current.cleanupConfirmedAt ? "cleanup_confirmed" : "captured",
        providerResultCapturedAt:
          current.providerResultCapturedAt ?? input.now.toISOString(),
        providerResultIdSha256:
          current.providerResultIdSha256 ?? input.providerResultIdSha256
      })),
      cleanupExpectedResourceIds,
      costs,
      costMicroUsd: costs.reduce(
        (total, event) => total + (event.actual_micro_usd ?? event.estimated_micro_usd ?? 0),
        0
      ),
      updatedAt: input.now.toISOString()
    };
  }, input.claim);
}

function mergeCleanupReceipts(existing: CleanupReceipt[], additions: CleanupReceipt[]) {
  const byId = new Map(existing.map((receipt) => [receipt.receiptId, receipt]));
  for (const receipt of additions) byId.set(receipt.receiptId, receipt);
  return [...byId.values()];
}

export async function recordSourceCleanupAttempt(input: {
  store: RunStore;
  runId: string;
  registrationId: string;
  receipts: CleanupReceipt[];
  claim?: ProcessingClaim;
  cancelWithoutResult?: boolean;
  now: Date;
}) {
  return input.store.update(input.runId, (record) => {
    const watchdog = watchdogById(record, input.registrationId);
    if (!watchdog) {
      throw new AppError("ANALYSIS_INCOMPLETE", "The source cleanup watchdog was not found.", {
        retryable: false
      });
    }
    const cleanupReceipts = mergeCleanupReceipts(record.cleanupReceipts, input.receipts);
    const deleted = new Set(cleanupReceipts
      .filter((receipt) => receipt.controlScope === "application" && receipt.status === "deleted")
      .map((receipt) => receipt.resourceId));
    const confirmed = watchdog.resourceIds.every((resourceId) => deleted.has(resourceId));
    return {
      ...updateWatchdog(record, input.registrationId, (current) => ({
        ...current,
        status: input.cancelWithoutResult
          ? confirmed ? "cancelled" : "cleanup_pending"
          : confirmed
            ? "cleanup_confirmed"
            : "cleanup_pending",
        cleanupLastAttemptAt: input.now.toISOString(),
        cleanupConfirmedAt: confirmed
          ? current.cleanupConfirmedAt ?? input.now.toISOString()
          : current.cleanupConfirmedAt,
        cleanupAttempts: current.cleanupAttempts + 1,
        cancelledAt: input.cancelWithoutResult && confirmed
          ? current.cancelledAt ?? input.now.toISOString()
          : current.cancelledAt
      })),
      cleanupReceipts,
      updatedAt: input.now.toISOString()
    };
  }, input.claim);
}

function cleanupTargetsForWatchdog(
  record: RunRecord,
  watchdog: SourceCleanupWatchdog,
  storage: UploadStorage
): CleanupTarget[] {
  const document = record.input?.documents[watchdog.documentIndex];
  if (!document) {
    throw new AppError(
      "SOURCE_CLEANUP_PENDING",
      "The cleanup watchdog cannot authorize a storage target after input metadata was removed.",
      { retryable: true }
    );
  }
  const stageResourceId = `staged:${record.id}:${watchdog.documentIndex}`;
  return watchdog.resourceIds.map((resourceId): CleanupTarget => {
    if (resourceId === stageResourceId) {
      return {
        resourceId,
        resourceKind: "staged_source",
        controlScope: "application",
        remove: () => storage.remove(stagingBlobPath(record.id, watchdog.documentIndex))
      };
    }
    if (
      document.source.type === "upload" &&
      resourceId === `blob:${document.source.blob_path}`
    ) {
      const blobPath = document.source.blob_path;
      return {
        resourceId,
        resourceKind: "source_blob",
        controlScope: "application",
        successDetail:
          "Incoming source content was purged and a verified replay-blocking fence remains until grant expiry.",
        remove: () => storage.purgeIncomingToFence(blobPath, record.id)
      };
    }
    throw new AppError(
      "SOURCE_CLEANUP_PENDING",
      "The cleanup watchdog rejected an unauthorized storage resource identifier.",
      { retryable: false }
    );
  });
}

export type SourceCleanupWatchdogOutcome =
  | "missing"
  | "waiting_for_capture"
  | "waiting_for_worker"
  | "cleanup_pending"
  | "complete"
  | "cancelled";

export async function runSourceCleanupWatchdog(input: {
  store: RunStore;
  storage: UploadStorage;
  runId: string;
  registrationId: string;
  now?: Date;
}): Promise<{ runId: string; registrationId: string; outcome: SourceCleanupWatchdogOutcome }> {
  const now = input.now ?? new Date();
  const record = await input.store.get(input.runId);
  if (!record) {
    return { runId: input.runId, registrationId: input.registrationId, outcome: "missing" };
  }
  const watchdog = watchdogById(record, input.registrationId);
  if (!watchdog) {
    return { runId: input.runId, registrationId: input.registrationId, outcome: "missing" };
  }
  if (watchdog.cleanupConfirmedAt) {
    if (["ready", "partial", "failed", "expired"].includes(record.status)) {
      return { runId: input.runId, registrationId: input.registrationId, outcome: "complete" };
    }
    const workerLeaseElapsed = record.processingLeaseExpiresAt !== null &&
      new Date(record.processingLeaseExpiresAt) <= now;
    const workerStatusNeedsFinalization =
      (LEASED_RUN_STATUSES as readonly RunRecord["status"][]).includes(record.status) ||
      record.status === "cleanup_pending";
    if (workerStatusNeedsFinalization && workerLeaseElapsed) {
      const finalized = await cleanupRun(record, input.store, input.storage, "failed", now, {
        onlyIfProcessingLeaseExpired: true
      });
      return {
        runId: input.runId,
        registrationId: input.registrationId,
        outcome: ["failed", "expired"].includes(finalized.status)
          ? "complete"
          : "waiting_for_worker"
      };
    }
    return {
      runId: input.runId,
      registrationId: input.registrationId,
      outcome: "waiting_for_worker"
    };
  }
  if (
    !watchdog.providerCallStartedAt &&
    ["ready", "partial", "failed", "expired"].includes(record.status)
  ) {
    return { runId: input.runId, registrationId: input.registrationId, outcome: "cancelled" };
  }
  // This is the central deletion guard: an armed watchdog is read-only until
  // the worker durably records a successful provider result capture. An
  // unobserved network/polling failure remains protected until the signed
  // access window expires; scheduling alone never authorizes deletion while
  // Monid may still be fetching the staging object.
  const sourceAccessExpired = watchdog.sourceAccessExpiresAt !== null &&
    new Date(watchdog.sourceAccessExpiresAt) <= now;
  if (!watchdog.providerResultCapturedAt && !sourceAccessExpired) {
    return {
      runId: input.runId,
      registrationId: input.registrationId,
      outcome: "waiting_for_capture"
    };
  }

  let updated = record;
  if (!watchdog.cleanupConfirmedAt) {
    const receipts = await executeCleanup(
      cleanupTargetsForWatchdog(record, watchdog, input.storage),
      () => now
    );
    updated = await recordSourceCleanupAttempt({
      store: input.store,
      runId: input.runId,
      registrationId: input.registrationId,
      receipts,
      cancelWithoutResult: !watchdog.providerResultCapturedAt,
      now
    });
    const refreshed = watchdogById(updated, input.registrationId);
    if (!refreshed?.cleanupConfirmedAt) {
      return {
        runId: input.runId,
        registrationId: input.registrationId,
        outcome: "cleanup_pending"
      };
    }
  }

  const workerLeaseElapsed = updated.processingLeaseExpiresAt !== null &&
    new Date(updated.processingLeaseExpiresAt) <= now;
  const workerStatusNeedsFinalization =
    (LEASED_RUN_STATUSES as readonly RunRecord["status"][]).includes(updated.status) ||
    updated.status === "cleanup_pending";
  if (workerStatusNeedsFinalization && workerLeaseElapsed) {
    updated = await cleanupRun(updated, input.store, input.storage, "failed", now, {
      onlyIfProcessingLeaseExpired: true
    });
  }
  if (["ready", "partial", "failed", "expired"].includes(updated.status)) {
    return { runId: input.runId, registrationId: input.registrationId, outcome: "complete" };
  }
  return {
    runId: input.runId,
    registrationId: input.registrationId,
    outcome: "waiting_for_worker"
  };
}

export function allCapturedSourceWatchdogsClean(record: RunRecord) {
  return record.sourceCleanupWatchdogs.every((watchdog) =>
    watchdog.providerResultCapturedAt !== null &&
    watchdog.cleanupConfirmedAt !== null &&
    watchdog.status === "cleanup_confirmed"
  );
}

export function applicationCleanupIsReleasable(record: RunRecord) {
  return cleanupGate(record) && allCapturedSourceWatchdogsClean(record);
}

export function sourceCleanupAuthorized(
  record: RunRecord,
  resourceId: string,
  now: Date
) {
  const watchdog = record.sourceCleanupWatchdogs.find((candidate) =>
    candidate.resourceIds.includes(resourceId)
  );
  if (!watchdog || !watchdog.providerCallStartedAt) return true;
  if (watchdog.providerResultCapturedAt) return true;
  return watchdog.sourceAccessExpiresAt !== null &&
    new Date(watchdog.sourceAccessExpiresAt) <= now;
}
