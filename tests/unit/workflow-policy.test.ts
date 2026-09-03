import { afterEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTests } from "@/lib/config";
import {
  assertMonidPaidCallStartWindow
} from "@/lib/pipeline";
import {
  PROCESSING_HEARTBEAT_INTERVAL_MS,
  PROCESSING_LEASE_MS
} from "@/lib/runs/store";
import {
  ANALYZE_RUN_CLEANUP_MAX_ATTEMPTS,
  ANALYZE_RUN_MAX_FLOW_HANDLER_ATTEMPTS,
  ANALYZE_RUN_MAX_LIFECYCLE_EVENTS,
  ANALYZE_RUN_MAX_STEP_ATTEMPTS,
  CLEANUP_RETRY_MAX_ATTEMPTS,
  CLEANUP_STEP_MAX_RETRIES,
  RETRY_CLEANUP_MAX_FLOW_HANDLER_ATTEMPTS,
  RETRY_CLEANUP_MAX_LIFECYCLE_EVENTS,
  RETRY_CLEANUP_MAX_STEP_ATTEMPTS,
  SOURCE_CLEANUP_WATCHDOG_MAX_FLOW_HANDLER_ATTEMPTS,
  SOURCE_CLEANUP_WATCHDOG_MAX_PACKAGE_WORKFLOWS,
  SOURCE_CLEANUP_WATCHDOG_MAX_STEP_ATTEMPTS,
  SOURCE_CLEANUP_WATCHDOG_REGISTRATIONS_PER_BATCH,
  UPLOAD_SWEEP_MAX_LIFECYCLE_EVENTS,
  UPLOAD_SWEEP_MAX_STEP_ATTEMPTS,
  WORKFLOW_BASE_EVENT_ENVELOPE,
  WORKFLOW_BASE_FLOW_HANDLER_ATTEMPT_ENVELOPE,
  WORKFLOW_BASE_FUNCTION_ATTEMPT_ENVELOPE,
  WORKFLOW_BASE_STEP_ATTEMPT_ENVELOPE,
  WORKFLOW_EVENTS_PER_DOCUMENT,
  WORKFLOW_FUNCTION_ATTEMPTS_PER_DOCUMENT,
  WORKFLOW_GENERATED_ROUTE_MAX_DURATION_SECONDS,
  WORKFLOW_HELPER_MAX_DURATION_SECONDS,
  WORKFLOW_STEP_ATTEMPTS_PER_DOCUMENT
} from "@/lib/workflow-cost-policy";
import {
  SOURCE_CLEANUP_CAPTURE_SLA_MS,
  SOURCE_CLEANUP_WATCHDOG_POLL_MS
} from "@/lib/runs/source-cleanup-watchdog";
import { maxDuration, processRunStep } from "@/workflows/analyze-run-step";
import {
  maxDuration as cleanupWatchdogMaxDuration,
  SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES,
  sourceCleanupWatchdogStep
} from "@/workflows/source-cleanup-watchdog-step";
import {
  maxDuration as cleanupRetryMaxDuration,
  retryCleanupStep
} from "@/workflows/retry-cleanup-step";
import {
  EXPIRY_STEP_BATCH_SIZE,
  expireDueRunsStep,
  expireRunStep,
  maxDuration as expiryMaxDuration
} from "@/workflows/expire-runs-step";
import {
  maxDuration as uploadSweepMaxDuration,
  sweepIncomingUploadsStep,
  UPLOAD_SWEEP_STEP_BATCH_SIZE
} from "@/workflows/sweep-incoming-uploads-step";
import {
  SOURCE_CLEANUP_WATCHDOG_MAX_LIFECYCLE_EVENTS,
  SOURCE_CLEANUP_WATCHDOG_MAX_POLLS,
  SOURCE_CLEANUP_WATCHDOG_POLL_DELAY_MS
} from "@/workflows/source-cleanup-watchdog";

describe("live workflow execution policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfigForTests();
  });

  it("uses the attested 300-second generated route ceiling without implicit retries", () => {
    expect([
      maxDuration,
      cleanupWatchdogMaxDuration,
      cleanupRetryMaxDuration,
      expiryMaxDuration,
      uploadSweepMaxDuration
    ]).toEqual([300, 300, 300, 300, 300]);
    expect(WORKFLOW_GENERATED_ROUTE_MAX_DURATION_SECONDS).toBe(300);
    expect(WORKFLOW_HELPER_MAX_DURATION_SECONDS).toBe(300);
    expect(CLEANUP_STEP_MAX_RETRIES).toBe(0);
    expect([
      processRunStep.maxRetries,
      sourceCleanupWatchdogStep.maxRetries,
      retryCleanupStep.maxRetries,
      expireRunStep.maxRetries,
      expireDueRunsStep.maxRetries,
      sweepIncomingUploadsStep.maxRetries
    ]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("rejects the deployed production step without a deployment-bound runtime receipt", async () => {
    vi.stubEnv("NODE_ENV", "production");
    resetConfigForTests();
    await expect(processRunStep("00000000-0000-4000-8000-000000000000"))
      .rejects.toThrow(/configured unattested/i);
  });

  it("bounds external deletion batches to one unit per Workflow step", () => {
    expect(EXPIRY_STEP_BATCH_SIZE).toBe(1);
    expect(UPLOAD_SWEEP_STEP_BATCH_SIZE).toBe(1);
  });

  it("does not start a paid parse with only a deadline sliver remaining", () => {
    expect(() => assertMonidPaidCallStartWindow(100_000, 40_000)).not.toThrow();
    expect(() => assertMonidPaidCallStartWindow(100_000, 40_001))
      .toThrow(/too short to start another paid parse/i);
  });

  it("keeps hard-kill cleanup recovery inside the capture SLA", () => {
    expect(PROCESSING_HEARTBEAT_INTERVAL_MS).toBe(10_000);
    expect(PROCESSING_LEASE_MS).toBe(45_000);
    expect(SOURCE_CLEANUP_WATCHDOG_POLL_MS).toBe(60_000);
    expect(SOURCE_CLEANUP_CAPTURE_SLA_MS).toBe(60_000);
    expect(PROCESSING_HEARTBEAT_INTERVAL_MS).toBeLessThan(PROCESSING_LEASE_MS);
    expect(PROCESSING_LEASE_MS).toBeLessThan(SOURCE_CLEANUP_CAPTURE_SLA_MS);
    expect(SOURCE_CLEANUP_WATCHDOG_POLL_MS).toBeLessThanOrEqual(
      SOURCE_CLEANUP_CAPTURE_SLA_MS
    );
    expect(cleanupWatchdogMaxDuration).toBe(300);
    expect(sourceCleanupWatchdogStep.maxRetries).toBe(0);
  });

  it("bounds package watchdog history and every generated handler attempt", () => {
    expect(SOURCE_CLEANUP_WATCHDOG_REGISTRATIONS_PER_BATCH).toBe(4);
    expect(SOURCE_CLEANUP_WATCHDOG_MAX_PACKAGE_WORKFLOWS).toBe(2);
    expect(SOURCE_CLEANUP_WATCHDOG_MAX_POLLS).toBe(3);
    expect(SOURCE_CLEANUP_WATCHDOG_POLL_DELAY_MS).toBe(60_000);
    expect((SOURCE_CLEANUP_WATCHDOG_MAX_POLLS - 1) *
      SOURCE_CLEANUP_WATCHDOG_POLL_DELAY_MS).toBe(120_000);
    expect(SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES).toBe(0);
    expect(CLEANUP_RETRY_MAX_ATTEMPTS).toBe(1);
    expect(ANALYZE_RUN_CLEANUP_MAX_ATTEMPTS).toBe(0);
    expect(SOURCE_CLEANUP_WATCHDOG_MAX_LIFECYCLE_EVENTS).toBe(16);
    expect(UPLOAD_SWEEP_MAX_LIFECYCLE_EVENTS).toBe(8);
    expect(ANALYZE_RUN_MAX_LIFECYCLE_EVENTS).toBe(6);
    expect(RETRY_CLEANUP_MAX_LIFECYCLE_EVENTS).toBe(6);
    expect(WORKFLOW_BASE_EVENT_ENVELOPE).toBe(1_000);
    expect(WORKFLOW_BASE_EVENT_ENVELOPE).toBeGreaterThanOrEqual(
      ANALYZE_RUN_MAX_LIFECYCLE_EVENTS +
        RETRY_CLEANUP_MAX_LIFECYCLE_EVENTS +
        SOURCE_CLEANUP_WATCHDOG_MAX_PACKAGE_WORKFLOWS *
          SOURCE_CLEANUP_WATCHDOG_MAX_LIFECYCLE_EVENTS
    );
    expect(WORKFLOW_EVENTS_PER_DOCUMENT).toBe(0);
    expect(ANALYZE_RUN_MAX_STEP_ATTEMPTS).toBe(1);
    expect(RETRY_CLEANUP_MAX_STEP_ATTEMPTS).toBe(1);
    expect(SOURCE_CLEANUP_WATCHDOG_MAX_STEP_ATTEMPTS).toBe(3);
    expect(UPLOAD_SWEEP_MAX_STEP_ATTEMPTS).toBe(1);
    expect(WORKFLOW_BASE_STEP_ATTEMPT_ENVELOPE).toBe(8);
    expect(WORKFLOW_STEP_ATTEMPTS_PER_DOCUMENT).toBe(0);
    expect(ANALYZE_RUN_MAX_FLOW_HANDLER_ATTEMPTS).toBe(2);
    expect(RETRY_CLEANUP_MAX_FLOW_HANDLER_ATTEMPTS).toBe(2);
    expect(SOURCE_CLEANUP_WATCHDOG_MAX_FLOW_HANDLER_ATTEMPTS).toBe(6);
    expect(WORKFLOW_BASE_FLOW_HANDLER_ATTEMPT_ENVELOPE).toBe(16);
    expect(WORKFLOW_BASE_FUNCTION_ATTEMPT_ENVELOPE).toBe(24);
    expect(WORKFLOW_FUNCTION_ATTEMPTS_PER_DOCUMENT).toBe(0);
    expect(WORKFLOW_BASE_EVENT_ENVELOPE + WORKFLOW_EVENTS_PER_DOCUMENT).toBe(1_000);
    expect(WORKFLOW_BASE_EVENT_ENVELOPE + 5 * WORKFLOW_EVENTS_PER_DOCUMENT).toBe(1_000);
    expect(WORKFLOW_BASE_FUNCTION_ATTEMPT_ENVELOPE +
      WORKFLOW_FUNCTION_ATTEMPTS_PER_DOCUMENT).toBe(24);
    expect(WORKFLOW_BASE_FUNCTION_ATTEMPT_ENVELOPE +
      5 * WORKFLOW_FUNCTION_ATTEMPTS_PER_DOCUMENT).toBe(24);
    expect(SOURCE_CLEANUP_WATCHDOG_MAX_LIFECYCLE_EVENTS).toBeLessThan(25_000);
  });
});
