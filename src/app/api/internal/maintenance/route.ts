import { getConfig, type AppConfig } from "@/lib/config";
import { constantTimeHexEqual, sha256Hex } from "@/lib/crypto";
import {
  MAINTENANCE_INVOCATION_BUDGET_MS,
  recordMaintenanceHeartbeat,
  type MaintenanceHeartbeatSummary
} from "@/lib/health/maintenance";
import { recoverUnscheduledRuns } from "@/lib/runs/create";
import { expireDueRuns } from "@/lib/runs/expiry";
import { getRunStore, type RunStore } from "@/lib/runs/store";
import type { BudgetGuard } from "@/lib/security/budget";
import { getUploadStorage, type UploadStorage } from "@/lib/storage/uploads";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const RECOVERY_BATCH_SIZE = 5;
const CLEANUP_BATCH_SIZE = 5;
const INCOMING_UPLOAD_BATCH_SIZE = 10;

class MaintenanceDeadlineExceeded extends Error {
  constructor() {
    super("The bounded maintenance invocation reached its internal deadline.");
    this.name = "MaintenanceDeadlineExceeded";
  }
}

interface MaintenanceDependencies {
  config?: AppConfig;
  store?: RunStore;
  storage?: UploadStorage;
  budget?: BudgetGuard;
  schedule?: (runId: string) => Promise<string | null>;
  now?: Date;
  timeBudgetMs?: number;
  monotonicNow?: () => number;
  recordHeartbeat?: (summary: MaintenanceHeartbeatSummary) => Promise<void>;
}

export function isAuthorizedMaintenanceRequest(request: Request, secret: string): boolean {
  const presented = request.headers.get("authorization") ?? "";
  return constantTimeHexEqual(
    sha256Hex(presented),
    sha256Hex(`Bearer ${secret}`)
  );
}

export async function handleMaintenance(
  request: Request,
  dependencies: MaintenanceDependencies = {}
): Promise<Response> {
  const config = dependencies.config ?? getConfig();
  if (!config.CRON_SECRET) {
    return Response.json({ error: "maintenance_unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!isAuthorizedMaintenanceRequest(request, config.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const now = dependencies.now ?? new Date();
  const timeBudgetMs = Math.min(
    Math.max(Math.trunc(dependencies.timeBudgetMs ?? MAINTENANCE_INVOCATION_BUDGET_MS), 1),
    MAINTENANCE_INVOCATION_BUDGET_MS
  );
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const startedAt = monotonicNow();
  const deadlineAt = startedAt + timeBudgetMs;
  const assertWithinDeadline = () => {
    if (monotonicNow() >= deadlineAt) throw new MaintenanceDeadlineExceeded();
  };
  const runBeforeDeadline = async <T>(run: () => Promise<T>): Promise<T> => {
    assertWithinDeadline();
    const remainingMs = Math.max(1, Math.ceil(deadlineAt - monotonicNow()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run(),
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new MaintenanceDeadlineExceeded()), remainingMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    const store = dependencies.store ?? await runBeforeDeadline(() => getRunStore());
    const storage = dependencies.storage ?? getUploadStorage(config);
    const recovered = await runBeforeDeadline(() => recoverUnscheduledRuns({
      config,
      store,
      uploadStorage: storage,
      budget: dependencies.budget,
      schedule: dependencies.schedule,
      now,
      batchLimit: RECOVERY_BATCH_SIZE,
      assertWithinDeadline
    }));
    const expired = await runBeforeDeadline(() => expireDueRuns(
      store,
      storage,
      now,
      CLEANUP_BATCH_SIZE,
      { incomingLimit: INCOMING_UPLOAD_BATCH_SIZE, assertWithinDeadline }
    ));
    assertWithinDeadline();
    const durationMs = Math.max(0, Math.ceil(monotonicNow() - startedAt));
    const heartbeat: MaintenanceHeartbeatSummary = {
      completedAt: new Date(now.getTime() + durationMs),
      durationMs,
      workBudgetMs: timeBudgetMs,
      recoveredRunCount: recovered.recoveredRunIds.length,
      admissionFailureCount: recovered.failedRunIds.length,
      admissionDeferredCount: recovered.deferredRunIds.length,
      expiredRunCount: expired.length
    };
    let heartbeatRecorded = false;
    if (dependencies.recordHeartbeat) {
      await runBeforeDeadline(() => dependencies.recordHeartbeat!(heartbeat));
      heartbeatRecorded = true;
    } else if (config.DATABASE_URL) {
      await runBeforeDeadline(() => recordMaintenanceHeartbeat(config.DATABASE_URL!, heartbeat));
      heartbeatRecorded = true;
    } else if (config.NODE_ENV === "production") {
      throw new Error("Durable maintenance heartbeat storage is unavailable.");
    }
    assertWithinDeadline();
    return Response.json({
      ok: true,
      bounded: true,
      maintenance_heartbeat_recorded: heartbeatRecorded,
      recovered_run_count: heartbeat.recoveredRunCount,
      admission_failure_count: heartbeat.admissionFailureCount,
      admission_deferred_count: heartbeat.admissionDeferredCount,
      expired_run_count: heartbeat.expiredRunCount,
      duration_ms: heartbeat.durationMs
    }, { headers: NO_STORE });
  } catch (error) {
    return Response.json({
      error: error instanceof MaintenanceDeadlineExceeded
        ? "maintenance_deadline_exceeded"
        : "maintenance_failed"
    }, { status: 503, headers: NO_STORE });
  }
}

export async function GET(request: Request) {
  return handleMaintenance(request);
}
