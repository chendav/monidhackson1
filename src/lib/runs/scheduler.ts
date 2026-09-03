import { getConfig } from "@/lib/config";
import { processRun } from "@/lib/pipeline";
import { getRunStore } from "@/lib/runs/store";

export async function scheduleRun(runId: string): Promise<string | null> {
  const config = getConfig();
  if (config.DATABASE_URL && process.env.VERCEL) {
    const [{ start }, { analyzeRunWorkflow }] = await Promise.all([
      import("workflow/api"),
      import("@/workflows/analyze-run")
    ]);
    const workflowRun = await start(analyzeRunWorkflow, [runId]);
    const store = await getRunStore();
    await store.update(runId, (record) => ({
      ...record,
      workflowRunId: workflowRun.runId,
      updatedAt: new Date().toISOString()
    }));
    return workflowRun.runId;
  }

  queueMicrotask(() => {
    void processRun(runId).catch(() => undefined);
  });
  return null;
}
