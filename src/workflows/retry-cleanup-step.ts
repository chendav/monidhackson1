import { cleanupRun } from "@/lib/runs/expiry";
import { getRunStore } from "@/lib/runs/store";
import { getUploadStorage } from "@/lib/storage/uploads";
import {
  CLEANUP_STEP_MAX_RETRIES,
  WORKFLOW_HELPER_MAX_DURATION_SECONDS
} from "@/lib/workflow-cost-policy";

export const maxDuration = WORKFLOW_HELPER_MAX_DURATION_SECONDS;

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

retryCleanupStep.maxRetries = CLEANUP_STEP_MAX_RETRIES;
