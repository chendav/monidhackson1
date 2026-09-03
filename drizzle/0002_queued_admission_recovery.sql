CREATE INDEX IF NOT EXISTS "runs_queued_admission_idx"
  ON "runs" ("created_at")
  WHERE "status" = 'queued' AND "workflow_run_id" IS NULL;
