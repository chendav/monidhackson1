import { cleanupRun } from "@/lib/runs/expiry";
import { getRunStore } from "@/lib/runs/store";
import { getUploadStorage } from "@/lib/storage/uploads";

export async function retryCleanupStep(runId: string) {
  "use step";

  const store = await getRunStore();
  const record = await store.get(runId);
  if (!record) return { runId, status: "missing" as const };
  if (record.status !== "cleanup_pending") return { runId, status: record.status };
  const cleaned = await cleanupRun(
    record,
    store,
    getUploadStorage(),
    record.terminalAfterCleanup ?? "failed"
  );
  return { runId, status: cleaned.status };
}

retryCleanupStep.maxRetries = 3;
