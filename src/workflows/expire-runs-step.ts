import { getRunStore } from "@/lib/runs/store";
import { expireDueRuns, expireRun } from "@/lib/runs/expiry";

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
  const expired = await expireDueRuns(store);
  return { expiredRunIds: expired.map((record) => record.id) };
}
