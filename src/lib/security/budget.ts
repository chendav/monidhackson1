import { neon } from "@neondatabase/serverless";
import { getConfig, type AppConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";

export interface BudgetReservationInput {
  runId: string;
  quotaKey: string;
  principalKind: "guest" | "api";
  amountMicroUsd: number;
  now?: Date;
}

export interface BudgetGuard {
  reserve(input: BudgetReservationInput): Promise<void>;
  settle(runId: string, actualMicroUsd: number, now?: Date): Promise<void>;
}

interface MemoryReservation {
  quotaKey: string;
  day: string;
  reserved: number;
  settled: number | null;
  createdAt: number;
}

export class InMemoryBudgetGuard implements BudgetGuard {
  private readonly reservations = new Map<string, MemoryReservation>();

  constructor(private readonly config: AppConfig = getConfig()) {}

  async reserve(input: BudgetReservationInput): Promise<void> {
    if (this.reservations.has(input.runId)) return;
    if (input.amountMicroUsd > this.config.MAX_RUN_COST_MICRO_USD) {
      throw new AppError("BUDGET_EXCEEDED", "The run estimate exceeds the per-run budget cap.", {
        httpStatus: 402
      });
    }
    const now = input.now ?? new Date();
    const hourlyLimit = input.principalKind === "api"
      ? this.config.API_RUNS_PER_HOUR
      : this.config.GUEST_RUNS_PER_HOUR;
    const oneHourAgo = now.getTime() - 3_600_000;
    const recent = [...this.reservations.values()].filter(
      (reservation) => reservation.quotaKey === input.quotaKey && reservation.createdAt >= oneHourAgo
    ).length;
    if (recent >= hourlyLimit) {
      throw new AppError("RATE_LIMITED", "The hourly run quota has been reached.", {
        httpStatus: 429,
        retryable: true
      });
    }
    const day = now.toISOString().slice(0, 10);
    const dailyCommitted = [...this.reservations.values()]
      .filter((reservation) => reservation.day === day)
      .reduce((total, reservation) => total + (reservation.settled ?? reservation.reserved), 0);
    if (dailyCommitted + input.amountMicroUsd > this.config.DAILY_COST_CAP_MICRO_USD) {
      throw new AppError("BUDGET_EXCEEDED", "The daily provider budget is exhausted.", {
        httpStatus: 402,
        retryable: true
      });
    }
    this.reservations.set(input.runId, {
      quotaKey: input.quotaKey,
      day,
      reserved: input.amountMicroUsd,
      settled: null,
      createdAt: now.getTime()
    });
  }

  async settle(runId: string, actualMicroUsd: number): Promise<void> {
    const reservation = this.reservations.get(runId);
    if (!reservation) return;
    reservation.settled = Math.max(0, Math.round(actualMicroUsd));
  }

  clear() {
    this.reservations.clear();
  }
}

export class NeonBudgetGuard implements BudgetGuard {
  private readonly sql;
  constructor(
    databaseUrl: string,
    private readonly config: AppConfig = getConfig()
  ) {
    this.sql = neon(databaseUrl);
  }

  async reserve(input: BudgetReservationInput): Promise<void> {
    if (input.amountMicroUsd > this.config.MAX_RUN_COST_MICRO_USD) {
      throw new AppError("BUDGET_EXCEEDED", "The run estimate exceeds the per-run budget cap.", {
        httpStatus: 402
      });
    }
    const now = input.now ?? new Date();
    const day = now.toISOString().slice(0, 10);
    const hourlyLimit = input.principalKind === "api"
      ? this.config.API_RUNS_PER_HOUR
      : this.config.GUEST_RUNS_PER_HOUR;
    const queries = [
      this.sql`SELECT pg_advisory_xact_lock(hashtext(${`rfp-xray-budget:${day}`}))`,
      this.sql`
        INSERT INTO budget_reservations
          (run_id, quota_key, day, reserved_micro_usd, created_at)
        SELECT
          ${input.runId}::uuid,
          ${input.quotaKey},
          ${day},
          ${input.amountMicroUsd},
          ${now.toISOString()}::timestamptz
        WHERE
          COALESCE((
            SELECT SUM(COALESCE(settled_micro_usd, reserved_micro_usd))
            FROM budget_reservations WHERE day = ${day}
          ), 0) + ${input.amountMicroUsd} <= ${this.config.DAILY_COST_CAP_MICRO_USD}
          AND (
            SELECT COUNT(*) FROM runs
            WHERE quota_key = ${input.quotaKey}
              AND created_at >= ${new Date(now.getTime() - 3_600_000).toISOString()}::timestamptz
          ) <= ${hourlyLimit}
        ON CONFLICT (run_id) DO NOTHING
        RETURNING run_id
      `
    ];
    const results = await this.sql.transaction(queries);
    const rows = results[1] as unknown as Array<{ run_id: string }>;
    if (!rows[0]) {
      const recent = await this.sql`
        SELECT COUNT(*)::int AS count FROM runs
        WHERE quota_key = ${input.quotaKey}
          AND created_at >= ${new Date(now.getTime() - 3_600_000).toISOString()}::timestamptz
      ` as unknown as Array<{ count: number }>;
      if ((recent[0]?.count ?? 0) > hourlyLimit) {
        throw new AppError("RATE_LIMITED", "The hourly run quota has been reached.", {
          httpStatus: 429,
          retryable: true
        });
      }
      throw new AppError("BUDGET_EXCEEDED", "The daily provider budget is exhausted.", {
        httpStatus: 402,
        retryable: true
      });
    }
  }

  async settle(runId: string, actualMicroUsd: number, now = new Date()): Promise<void> {
    await this.sql`
      UPDATE budget_reservations
      SET settled_micro_usd = ${Math.max(0, Math.round(actualMicroUsd))},
          settled_at = ${now.toISOString()}::timestamptz
      WHERE run_id = ${runId}::uuid
    `;
  }
}

let guardOverride: BudgetGuard | undefined;
let memoryGuard: InMemoryBudgetGuard | undefined;
let neonGuard: NeonBudgetGuard | undefined;

export function setBudgetGuardForTests(guard: BudgetGuard | undefined) {
  guardOverride = guard;
}

export function getBudgetGuard(config = getConfig()): BudgetGuard {
  if (guardOverride) return guardOverride;
  if (config.DATABASE_URL) {
    neonGuard ??= new NeonBudgetGuard(config.DATABASE_URL, config);
    return neonGuard;
  }
  if (config.NODE_ENV === "production") {
    throw new AppError("ANALYSIS_INCOMPLETE", "Persistent budget enforcement is not configured.", {
      httpStatus: 503,
      retryable: true
    });
  }
  memoryGuard ??= new InMemoryBudgetGuard(config);
  return memoryGuard;
}

export function resetBudgetGuardForTests() {
  memoryGuard?.clear();
  memoryGuard = undefined;
  neonGuard = undefined;
  guardOverride = undefined;
}
