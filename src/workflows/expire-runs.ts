import { expireDueRunsStep } from "@/workflows/expire-runs-step";

export async function expireRunsWorkflow() {
  "use workflow";

  return expireDueRunsStep();
}
