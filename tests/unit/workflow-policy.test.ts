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
  SOURCE_CLEANUP_CAPTURE_SLA_MS,
  SOURCE_CLEANUP_WATCHDOG_POLL_MS
} from "@/lib/runs/source-cleanup-watchdog";
import { maxDuration, processRunStep } from "@/workflows/analyze-run-step";
import {
  maxDuration as cleanupWatchdogMaxDuration,
  SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES,
  sourceCleanupWatchdogStep
} from "@/workflows/source-cleanup-watchdog-step";
import { maxDuration as cleanupRetryMaxDuration } from "@/workflows/retry-cleanup-step";
import {
  EXPIRY_STEP_BATCH_SIZE,
  maxDuration as expiryMaxDuration
} from "@/workflows/expire-runs-step";
import {
  maxDuration as uploadSweepMaxDuration,
  UPLOAD_SWEEP_STEP_BATCH_SIZE
} from "@/workflows/sweep-incoming-uploads-step";
import {
  SOURCE_CLEANUP_WATCHDOG_BACKOFF_MS,
  SOURCE_CLEANUP_WATCHDOG_FAST_POLLS,
  SOURCE_CLEANUP_WATCHDOG_MAX_LIFECYCLE_EVENTS,
  SOURCE_CLEANUP_WATCHDOG_MAX_POLLS,
  sourceCleanupWatchdogPollDelayMs
} from "@/workflows/source-cleanup-watchdog";

describe("live workflow execution policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfigForTests();
  });

  it("declares 300 seconds for analysis and 50 seconds for cleanup helpers", () => {
    expect([
      maxDuration,
      cleanupWatchdogMaxDuration,
      cleanupRetryMaxDuration,
      expiryMaxDuration,
      uploadSweepMaxDuration
    ]).toEqual([300, 50, 50, 50, 50]);
    expect(processRunStep.maxRetries).toBe(0);
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
    expect(SOURCE_CLEANUP_WATCHDOG_POLL_MS).toBe(10_000);
    expect(SOURCE_CLEANUP_CAPTURE_SLA_MS).toBe(60_000);
    expect(PROCESSING_HEARTBEAT_INTERVAL_MS).toBeLessThan(PROCESSING_LEASE_MS);
    expect(PROCESSING_LEASE_MS).toBeLessThan(SOURCE_CLEANUP_CAPTURE_SLA_MS);
    expect(SOURCE_CLEANUP_WATCHDOG_POLL_MS).toBeLessThan(
      SOURCE_CLEANUP_CAPTURE_SLA_MS
    );
    expect(cleanupWatchdogMaxDuration).toBe(50);
    expect(sourceCleanupWatchdogStep.maxRetries).toBe(3);
  });

  it("bounds watchdog history and backs off without violating the cleanup SLA", () => {
    const delays = Array.from(
      { length: SOURCE_CLEANUP_WATCHDOG_MAX_POLLS - 1 },
      (_, attempt) => sourceCleanupWatchdogPollDelayMs(attempt)
    );
    expect(SOURCE_CLEANUP_WATCHDOG_FAST_POLLS).toBe(7);
    expect(delays.slice(0, 6)).toEqual(Array(6).fill(SOURCE_CLEANUP_WATCHDOG_POLL_MS));
    expect(delays.slice(6).every((delay) => delay === SOURCE_CLEANUP_WATCHDOG_BACKOFF_MS)).toBe(true);
    expect(Math.max(...delays)).toBeLessThan(SOURCE_CLEANUP_CAPTURE_SLA_MS);
    expect(delays.reduce((total, delay) => total + delay, 0)).toBeGreaterThan(5 * 60_000);
    expect(SOURCE_CLEANUP_WATCHDOG_STEP_MAX_RETRIES).toBe(3);
    expect(SOURCE_CLEANUP_WATCHDOG_MAX_LIFECYCLE_EVENTS).toBe(421);
    expect(SOURCE_CLEANUP_WATCHDOG_MAX_LIFECYCLE_EVENTS).toBeLessThan(25_000);
  });
});
