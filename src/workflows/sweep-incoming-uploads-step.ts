import { getUploadStorage } from "@/lib/storage/uploads";

export async function sweepIncomingUploadsStep() {
  "use step";

  const deleted = await getUploadStorage().sweepExpiredIncoming(new Date(), 100);
  return { deletedCount: deleted.length };
}

sweepIncomingUploadsStep.maxRetries = 3;
