import { cleanupGate, executeCleanup } from "@/lib/cleanup";
import { transitionRun } from "@/lib/runs/state-machine";
import type { RunStore } from "@/lib/runs/store";
import type { RunRecord } from "@/lib/runs/types";
import { getUploadStorage, type UploadStorage } from "@/lib/storage/uploads";

export async function expireRun(
  record: RunRecord,
  store: RunStore,
  storage: UploadStorage = getUploadStorage(),
  now = new Date()
): Promise<RunRecord> {
  if (record.status === "expired") return record;
  const targets = record.input.documents.flatMap((document) => {
    if (document.source.type !== "upload") return [];
    const blobPath = document.source.blob_path;
    return [{
      resourceId: `blob:${blobPath}`,
      resourceKind: "source_blob" as const,
      controlScope: "application" as const,
      remove: () => storage.remove(blobPath)
    }];
  });
  const receipts = await executeCleanup(targets, () => now);
  return store.update(record.id, (current) => {
    if (current.status === "expired") return current;
    const cleanupReceipts = [...current.cleanupReceipts, ...receipts];
    const cleanupConfirmed = current.cleanupExpectedResourceIds.length === 0 || cleanupGate({
      cleanupExpectedResourceIds: current.cleanupExpectedResourceIds,
      cleanupReceipts
    });
    return {
      ...transitionRun(current, "expired", now),
      result: null,
      cleanupReceipts,
      cleanupConfirmed,
      manifests: current.manifests.map((manifest) => ({
        ...manifest,
        cleanup_status: manifest.cleanup_status === "deleted" || cleanupConfirmed
          ? "deleted" as const
          : "failed" as const
      })),
      deletedAt: now.toISOString()
    };
  });
}

export async function expireDueRuns(
  store: RunStore,
  storage: UploadStorage = getUploadStorage(),
  now = new Date()
) {
  const expired = await store.listExpired(now);
  const results: RunRecord[] = [];
  for (const record of expired) {
    results.push(await expireRun(record, store, storage, now));
  }
  return results;
}
