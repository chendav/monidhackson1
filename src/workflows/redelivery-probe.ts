import type { RedeliveryProbeBinding } from "@/workflows/redelivery-probe-policy";
import { redeliveryProbeStep } from "@/workflows/redelivery-probe-step";

export async function redeliveryProbeWorkflow(binding: RedeliveryProbeBinding) {
  "use workflow";

  return redeliveryProbeStep(binding);
}
