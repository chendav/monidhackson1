ALTER TABLE "runs"
ADD COLUMN IF NOT EXISTS "analysis_dispatch_claim_id" uuid;
--> statement-breakpoint

ALTER TABLE "runs"
ADD COLUMN IF NOT EXISTS "analysis_dispatch_claimed_at" timestamptz;
--> statement-breakpoint

ALTER TABLE "runs"
ADD COLUMN IF NOT EXISTS "analysis_dispatch_status" text;
--> statement-breakpoint

ALTER TABLE "runs"
ADD COLUMN IF NOT EXISTS "analysis_dispatch_uncertain_at" timestamptz;
--> statement-breakpoint

-- Older deployments used an expiring admission lease and workflow_run_id as
-- an implicit dispatch marker. Conservatively fence every row that might have
-- reached Workflow start so deploying this migration can never redispatch it.
UPDATE "runs"
SET
  "analysis_dispatch_claim_id" = "id",
  "analysis_dispatch_claimed_at" = "updated_at",
  "analysis_dispatch_status" = CASE
    WHEN "workflow_run_id" IS NULL THEN 'dispatch_uncertain'
    ELSE 'scheduled'
  END,
  "analysis_dispatch_uncertain_at" = CASE
    WHEN "workflow_run_id" IS NULL THEN "updated_at"
    ELSE NULL
  END
WHERE "analysis_dispatch_claim_id" IS NULL
  AND ("workflow_run_id" IS NOT NULL OR "admission_lease_id" IS NOT NULL);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "runs_analysis_dispatch_recovery_idx"
ON "runs" ("analysis_dispatch_claimed_at")
WHERE "status" = 'queued' AND "analysis_dispatch_claim_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "runs"
ADD COLUMN IF NOT EXISTS "cleanup_retry_claim_id" uuid;
--> statement-breakpoint

ALTER TABLE "runs"
ADD COLUMN IF NOT EXISTS "cleanup_retry_claimed_at" timestamptz;
--> statement-breakpoint

ALTER TABLE "runs"
ADD COLUMN IF NOT EXISTS "cleanup_retry_workflow_run_id" text;
--> statement-breakpoint

ALTER TABLE "runs"
ADD COLUMN IF NOT EXISTS "cleanup_retry_dispatch_status" text;
--> statement-breakpoint

ALTER TABLE "runs"
ADD COLUMN IF NOT EXISTS "cleanup_retry_dispatch_uncertain_at" timestamptz;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "runs_cleanup_retry_uncertain_idx"
ON "runs" ("cleanup_retry_dispatch_uncertain_at")
WHERE "status" = 'cleanup_pending' AND "cleanup_retry_dispatch_uncertain_at" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "runs_cleanup_retry_dispatching_idx"
ON "runs" ("cleanup_retry_claimed_at")
WHERE "status" = 'cleanup_pending' AND "cleanup_retry_dispatch_status" = 'dispatching';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "runs_cleanup_pending_updated_idx"
ON "runs" ("updated_at")
WHERE "status" = 'cleanup_pending';
--> statement-breakpoint

INSERT INTO "app_schema_meta" ("id", "schema_version", "marker", "updated_at")
VALUES ('current', 9, 'rfp-xray-schema-v9', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "schema_version" = EXCLUDED."schema_version",
  "marker" = EXCLUDED."marker",
  "updated_at" = EXCLUDED."updated_at";
