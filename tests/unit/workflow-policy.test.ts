import { describe, expect, it } from "vitest";
import { LIVE_NETWORK_BUDGET_MS } from "@/lib/pipeline";
import { maxDuration, processRunStep } from "@/workflows/analyze-run-step";

describe("live workflow execution policy", () => {
  it("uses the Pro duration ceiling without retrying the paid pipeline step", () => {
    expect(maxDuration).toBe(800);
    expect(processRunStep.maxRetries).toBe(0);
    expect(LIVE_NETWORK_BUDGET_MS).toBe(600_000);
  });
});
