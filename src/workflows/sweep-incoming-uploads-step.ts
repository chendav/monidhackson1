import { getUploadStorage } from "@/lib/storage/uploads";
import {
  CLEANUP_STEP_MAX_RETRIES,
  WORKFLOW_HELPER_MAX_DURATION_SECONDS
} from "@/lib/workflow-cost-policy";

export const maxDuration = WORKFLOW_HELPER_MAX_DURATION_SECONDS;
export const UPLOAD_SWEEP_STEP_BATCH_SIZE = 1;

export async function sweepIncomingUploadsStep() {
  "use step";

  // A grant workflow owns one due object; broader cleanup is handled by the
  // recurring maintenance endpoint without making this step depend on a long
  // serial S3 batch.
  const deleted = await getUploadStorage().sweepExpiredIncoming(
    new Date(),
    UPLOAD_SWEEP_STEP_BATCH_SIZE
  );
  return { deletedCount: deleted.length };
}

sweepIncomingUploadsStep.maxRetries = CLEANUP_STEP_MAX_RETRIES;
