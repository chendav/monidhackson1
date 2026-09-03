import { neon } from "@neondatabase/serverless";

export const MAINTENANCE_HEARTBEAT_ID = "five-minute-sweep";
export const MAINTENANCE_HEARTBEAT_INTERVAL_MS = 5 * 60_000;
export const MAINTENANCE_HEARTBEAT_MAX_AGE_MS = 3 * MAINTENANCE_HEARTBEAT_INTERVAL_MS;
export const MAINTENANCE_HEARTBEAT_MAX_FUTURE_SKEW_MS = 60_000;
export const MAINTENANCE_INVOCATION_BUDGET_MS = 45_000;
export const MAINTENANCE_MAX_RECORDED_DURATION_MS = 50_000;

export interface MaintenanceHeartbeatSummary {
  completedAt: Date;
  durationMs: number;
  workBudgetMs: number;
  recoveredRunCount: number;
  admissionFailureCount: number;
  admissionDeferredCount: number;
  expiredRunCount: number;
}

interface MaintenanceHeartbeatRow {
  completed_at: Date | string;
  duration_ms: number;
  work_budget_ms: number;
}

export type MaintenanceHeartbeatHealth =
  | { status: "fresh"; completedAt: string; ageMs: number }
  | { status: "missing" | "stale" | "unreachable" };

function isBoundedSuccessfulHeartbeat(row: MaintenanceHeartbeatRow): boolean {
  return Number.isInteger(row.duration_ms) && row.duration_ms >= 0 &&
    row.duration_ms <= MAINTENANCE_MAX_RECORDED_DURATION_MS &&
    Number.isInteger(row.work_budget_ms) && row.work_budget_ms > 0 &&
    row.work_budget_ms <= MAINTENANCE_INVOCATION_BUDGET_MS &&
    row.duration_ms <= row.work_budget_ms;
}

/**
 * Read the durable proof that the recurring five-minute maintenance path
 * completed. Provider errors are deliberately collapsed so public health can
 * never reveal a connection string or provider response.
 */
export async function probeMaintenanceHeartbeat(
  databaseUrl: string | undefined,
  now = new Date(),
  options: {
    timeoutMs?: number;
    query?: () => Promise<MaintenanceHeartbeatRow[]>;
  } = {}
): Promise<MaintenanceHeartbeatHealth> {
  if (!databaseUrl) return { status: "missing" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const query = options.query ?? (async () => {
      const sql = neon(databaseUrl);
      return await sql`
        SELECT completed_at, duration_ms, work_budget_ms
        FROM maintenance_heartbeats
        WHERE id = ${MAINTENANCE_HEARTBEAT_ID}
        LIMIT 1
      ` as MaintenanceHeartbeatRow[];
    });
    const rows = await Promise.race([
      query(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("heartbeat probe timed out")),
          options.timeoutMs ?? 2_500
        );
        timer.unref?.();
      })
    ]);
    const row = rows[0];
    if (rows.length !== 1 || !row || !isBoundedSuccessfulHeartbeat(row)) {
      return rows.length === 0 ? { status: "missing" } : { status: "stale" };
    }
    const completedAt = new Date(row.completed_at);
    const ageMs = now.getTime() - completedAt.getTime();
    // A future timestamp beyond normal distributed-clock skew is not evidence
    // of a recent completed invocation.
    if (!Number.isFinite(ageMs) || ageMs < -MAINTENANCE_HEARTBEAT_MAX_FUTURE_SKEW_MS ||
      ageMs > MAINTENANCE_HEARTBEAT_MAX_AGE_MS) {
      return { status: "stale" };
    }
    return { status: "fresh", completedAt: completedAt.toISOString(), ageMs: Math.max(0, ageMs) };
  } catch {
    return { status: "unreachable" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Persist counts and timing only; no run ids, tender content, or credentials. */
export async function recordMaintenanceHeartbeat(
  databaseUrl: string,
  summary: MaintenanceHeartbeatSummary,
  options: {
    execute?: (summary: MaintenanceHeartbeatSummary) => Promise<void>;
  } = {}
): Promise<void> {
  if (!isBoundedSuccessfulHeartbeat({
    completed_at: summary.completedAt,
    duration_ms: summary.durationMs,
    work_budget_ms: summary.workBudgetMs
  })) {
    throw new Error("maintenance heartbeat is not bounded");
  }
  if (options.execute) {
    await options.execute(summary);
    return;
  }
  const sql = neon(databaseUrl);
  await sql`
    INSERT INTO maintenance_heartbeats (
      id, completed_at, duration_ms, work_budget_ms, recovered_run_count,
      admission_failure_count, admission_deferred_count, expired_run_count, updated_at
    ) VALUES (
      ${MAINTENANCE_HEARTBEAT_ID}, ${summary.completedAt}, ${summary.durationMs},
      ${summary.workBudgetMs}, ${summary.recoveredRunCount}, ${summary.admissionFailureCount},
      ${summary.admissionDeferredCount}, ${summary.expiredRunCount}, ${summary.completedAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      completed_at = EXCLUDED.completed_at,
      duration_ms = EXCLUDED.duration_ms,
      work_budget_ms = EXCLUDED.work_budget_ms,
      recovered_run_count = EXCLUDED.recovered_run_count,
      admission_failure_count = EXCLUDED.admission_failure_count,
      admission_deferred_count = EXCLUDED.admission_deferred_count,
      expired_run_count = EXCLUDED.expired_run_count,
      updated_at = EXCLUDED.updated_at
    WHERE maintenance_heartbeats.completed_at <= EXCLUDED.completed_at
  `;
}
