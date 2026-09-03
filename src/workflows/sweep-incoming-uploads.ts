import { sleep } from "workflow";
import { sweepIncomingUploadsStep } from "@/workflows/sweep-incoming-uploads-step";

export async function sweepIncomingUploadsWorkflow(expiresAt: string) {
  "use workflow";

  await sleep(new Date(new Date(expiresAt).getTime() + 5 * 60_000));
  return sweepIncomingUploadsStep();
}
