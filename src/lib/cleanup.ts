import type { CleanupReceipt, RunRecord } from "@/lib/runs/types";

export interface CleanupTarget {
  resourceId: string;
  resourceKind: CleanupReceipt["resourceKind"];
  controlScope: CleanupReceipt["controlScope"];
  remove?: () => Promise<void>;
  unknownDetail?: string;
}

export async function executeCleanup(
  targets: CleanupTarget[],
  now: () => Date = () => new Date()
): Promise<CleanupReceipt[]> {
  return Promise.all(
    targets.map(async (target): Promise<CleanupReceipt> => {
      const attemptedAt = now().toISOString();
      if (target.controlScope === "provider" && !target.remove) {
        return {
          receiptId: crypto.randomUUID(),
          resourceId: target.resourceId,
          resourceKind: target.resourceKind,
          controlScope: "provider",
          status: "unknown",
          attemptedAt,
          confirmedAt: null,
          detail: target.unknownDetail ?? "Provider retention and early-deletion capability are unknown."
        };
      }

      try {
        await target.remove?.();
        return {
          receiptId: crypto.randomUUID(),
          resourceId: target.resourceId,
          resourceKind: target.resourceKind,
          controlScope: target.controlScope,
          status: "deleted",
          attemptedAt,
          confirmedAt: now().toISOString(),
          detail: "Deletion confirmed by the controlling adapter."
        };
      } catch {
        return {
          receiptId: crypto.randomUUID(),
          resourceId: target.resourceId,
          resourceKind: target.resourceKind,
          controlScope: target.controlScope,
          status: "failed",
          attemptedAt,
          confirmedAt: null,
          detail: "Deletion could not be confirmed; sensitive details were suppressed."
        };
      }
    })
  );
}

export function cleanupGate(record: Pick<RunRecord, "cleanupExpectedResourceIds" | "cleanupReceipts">) {
  const expected = new Set(record.cleanupExpectedResourceIds);
  if (expected.size === 0) return false;
  const deleted = new Set(
    record.cleanupReceipts
      .filter((receipt) => receipt.controlScope === "application" && receipt.status === "deleted")
      .map((receipt) => receipt.resourceId)
  );
  return [...expected].every((resourceId) => deleted.has(resourceId));
}

export function cleanupDisclosure(receipts: CleanupReceipt[]) {
  const providerUnknown = receipts.some(
    (receipt) => receipt.controlScope === "provider" && receipt.status === "unknown"
  );
  return {
    application_controlled_deleted: receipts
      .filter((receipt) => receipt.controlScope === "application")
      .every((receipt) => receipt.status === "deleted"),
    provider_retention: providerUnknown ? "unknown" : "not_applicable"
  } as const;
}
