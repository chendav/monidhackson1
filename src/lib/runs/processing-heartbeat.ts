import { AppError } from "@/lib/errors";
import {
  PROCESSING_HEARTBEAT_INTERVAL_MS,
  PROCESSING_LEASE_MS,
  type RunStore
} from "@/lib/runs/store";

interface ProcessingClaim {
  leaseId: string;
  fence: number;
}

/**
 * Keep the short processing lease alive while a worker is healthy. When the
 * process is hard-killed no timer survives, so the independent cleanup
 * watchdog can establish quiescence no later than one lease interval after
 * the last successful heartbeat.
 */
export function startProcessingHeartbeat(input: {
  store: RunStore;
  runId: string;
  claim: ProcessingClaim;
  now?: () => Date;
  intervalMs?: number;
  leaseMs?: number;
}) {
  const now = input.now ?? (() => new Date());
  const intervalMs = input.intervalMs ?? PROCESSING_HEARTBEAT_INTERVAL_MS;
  const leaseMs = input.leaseMs ?? PROCESSING_LEASE_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  let failure: unknown = null;

  const schedule = () => {
    if (stopped || failure) return;
    timer = setTimeout(() => {
      inFlight = (async () => {
        const refreshed = await input.store.heartbeatProcessing(
          input.runId,
          input.claim,
          now(),
          leaseMs
        );
        if (!refreshed) {
          throw new AppError(
            "ANALYSIS_INCOMPLETE",
            "The processing lease was revoked while the worker was active.",
            { retryable: false }
          );
        }
      })().catch((error) => {
        failure = error;
      }).finally(schedule);
    }, intervalMs);
    timer.unref?.();
  };

  schedule();

  return {
    assertHealthy() {
      if (failure) throw failure;
    },
    async stop(options: { suppressFailure?: boolean } = {}) {
      if (!stopped) {
        stopped = true;
        if (timer) clearTimeout(timer);
        await inFlight;
      }
      if (failure && !options.suppressFailure) throw failure;
    }
  };
}
