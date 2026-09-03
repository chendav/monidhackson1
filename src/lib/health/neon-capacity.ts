import { neon } from "@neondatabase/serverless";
import {
  hasConservativeNeonCapacityConfig,
  type AppConfig
} from "@/lib/config";
import { AppError } from "@/lib/errors";

export type NeonCapacityHealth =
  | { status: "attested"; maxWorkerProcesses: number; costCuCeiling: number }
  | { status: "configured_unattested" | "mismatch" | "unreachable" };

interface MaxWorkerProcessesRow {
  max_worker_processes: string | number;
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Neon capacity probe timed out")), timeoutMs);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Binds the cost ceiling to a live, provider-controlled Postgres setting.
 * Provider errors are collapsed so a connection URL can never escape.
 */
export async function probeNeonCapacity(
  databaseUrl: string | undefined,
  config: AppConfig,
  options: {
    timeoutMs?: number;
    query?: () => Promise<MaxWorkerProcessesRow[]>;
  } = {}
): Promise<NeonCapacityHealth> {
  if (!databaseUrl || !hasConservativeNeonCapacityConfig(config)) {
    return { status: "configured_unattested" };
  }
  try {
    const query = options.query ?? (async () => {
      const sql = neon(databaseUrl);
      return await sql.query(
        "SHOW max_worker_processes",
        []
      ) as MaxWorkerProcessesRow[];
    });
    const rows = await within(query(), options.timeoutMs ?? 2_500);
    const observed = Number(rows[0]?.max_worker_processes);
    if (
      rows.length !== 1 ||
      !Number.isSafeInteger(observed) ||
      observed !== config.NEON_EXPECTED_MAX_WORKER_PROCESSES
    ) {
      return { status: "mismatch" };
    }
    return {
      status: "attested",
      maxWorkerProcesses: observed,
      costCuCeiling: config.NEON_COST_CU_CEILING
    };
  } catch {
    return { status: "unreachable" };
  }
}

export async function assertNeonCapacityAttested(
  config: AppConfig,
  options: { probe?: () => Promise<NeonCapacityHealth> } = {}
) {
  if (config.NODE_ENV !== "production") return null;
  const health = options.probe
    ? await options.probe()
    : await probeNeonCapacity(config.DATABASE_URL, config);
  if (health.status !== "attested") {
    throw new AppError(
      "ANALYSIS_INCOMPLETE",
      `The Neon cost capacity is ${health.status.replaceAll("_", " ")}.`,
      { httpStatus: 503, retryable: true }
    );
  }
  return health;
}
