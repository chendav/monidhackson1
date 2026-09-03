ALTER TABLE "runs"
  ADD COLUMN IF NOT EXISTS "admission_lease_id" uuid,
  ADD COLUMN IF NOT EXISTS "admission_lease_expires_at" timestamptz;
--> statement-breakpoint

DROP INDEX IF EXISTS "runs_queued_admission_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_queued_admission_idx"
  ON "runs" ("updated_at")
  WHERE "status" = 'queued';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "upload_quota_events_created_at_idx"
  ON "upload_quota_events" ("created_at");
