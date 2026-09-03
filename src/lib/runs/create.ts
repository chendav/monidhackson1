import { CreateRunResponseSchema, type CreateRunRequest } from "@/contracts";
import { getConfig, type AppConfig } from "@/lib/config";
import { asAppError } from "@/lib/errors";
import { transitionRun } from "@/lib/runs/state-machine";
import { getRunStore, type RunStore } from "@/lib/runs/store";
import { scheduleRun } from "@/lib/runs/scheduler";
import type { Principal } from "@/lib/security/auth";
import { uploadNamespaceSecret } from "@/lib/security/auth";
import { getBudgetGuard, type BudgetGuard } from "@/lib/security/budget";
import { validateCreateRunRequest } from "@/lib/source-validation";

export interface CreateRunDependencies {
  config?: AppConfig;
  store?: RunStore;
  budget?: BudgetGuard;
  schedule?: (runId: string) => Promise<string | null>;
}

export async function createRun(
  rawInput: unknown,
  principal: Principal,
  idempotencyKey: string | null,
  dependencies: CreateRunDependencies = {}
) {
  const config = dependencies.config ?? getConfig();
  const store = dependencies.store ?? await getRunStore();
  const input: CreateRunRequest = validateCreateRunRequest(rawInput, {
    ownerId: principal.id,
    uploadSecret: uploadNamespaceSecret(config)
  });
  const reservedMicroUsd =
    config.MONID_PARSE_RESERVE_MICRO_USD * input.documents.length +
    config.OPENAI_RUN_RESERVE_MICRO_USD;
  const runId = crypto.randomUUID();
  const created = await store.create({
    id: runId,
    ownerId: principal.id,
    quotaKey: principal.quotaKey,
    input,
    idempotencyKey,
    reservedMicroUsd
  });
  if (created.created) {
    const budget = dependencies.budget ?? getBudgetGuard(config);
    try {
      await budget.reserve({
        runId: created.record.id,
        quotaKey: principal.quotaKey,
        principalKind: principal.kind,
        amountMicroUsd: reservedMicroUsd
      });
      const workflowRunId = await (dependencies.schedule ?? scheduleRun)(created.record.id);
      if (workflowRunId) {
        created.record.workflowRunId = workflowRunId;
      }
    } catch (error) {
      const failure = asAppError(error);
      created.record = await store.update(created.record.id, (record) => ({
        ...transitionRun(record, "failed"),
        error: {
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
          request_id: failure.requestId
        }
      }));
    }
  }
  return {
    record: created.record,
    response: CreateRunResponseSchema.parse({
      run_id: created.record.id,
      status: created.record.status,
      status_url: `/api/v1/runs/${created.record.id}`
    }),
    created: created.created
  };
}
