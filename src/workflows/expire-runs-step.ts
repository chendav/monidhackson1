import { getRunStore } from "@/lib/runs/store";
import { expireDueRuns, expireRun } from "@/lib/runs/expiry";

export const maxDuration = 50;
export const EXPIRY_STEP_BATCH_SIZE = 1;

export async function expireRunStep(runId: string) {
  "use step";

  const store = await getRunStore();
  const record = await store.get(runId);
  if (!record) return { runId, status: "missing" as const };
  const expired = await expireRun(record, store);
  return { runId, status: expired.status };
}

export async function expireDueRunsStep() {
  "use step";

  const store = await getRunStore();
  // One run per step keeps the worst-case external deletion set bounded. The
  // maintenance endpoint revisits the remaining due rows idempotently.
  const expired = await expireDueRuns(
    store,
    undefined,
    undefined,
    EXPIRY_STEP_BATCH_SIZE
  );
  return { expiredRunIds: expired.map((record) => record.id) };
}
