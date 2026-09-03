import { describe, expect, it } from "vitest";
import {
  PRE_MODEL_DEADLINE_MS,
  RESULT_COMMIT_DEADLINE_MS,
  terminalStatusForAnalysis
} from "@/lib/pipeline";
import { OPENAI_EXTRACTION_PHASE_TIMEOUT_MS } from "@/lib/providers/openai";

describe("analysis terminal status", () => {
  it("publishes complete analysis that still needs bidder clarification as READY", () => {
    expect(terminalStatusForAnalysis({ decision_readiness: "needs_clarification" })).toBe("ready");
    expect(terminalStatusForAnalysis({ decision_readiness: "ready_for_bidder_assessment" })).toBe("ready");
  });

  it("keeps structurally incomplete extraction PARTIAL", () => {
    expect(terminalStatusForAnalysis({ decision_readiness: "incomplete" })).toBe("partial");
  });

  it("keeps model extraction inside the workflow result-commit envelope", () => {
    expect(PRE_MODEL_DEADLINE_MS + OPENAI_EXTRACTION_PHASE_TIMEOUT_MS)
      .toBeLessThanOrEqual(RESULT_COMMIT_DEADLINE_MS - 15_000);
  });
});
