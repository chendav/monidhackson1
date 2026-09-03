ALTER TABLE "runs"
  ADD COLUMN IF NOT EXISTS "source_cleanup_watchdogs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "paid_provider_attempt_started_at" timestamptz;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "runs_paid_provider_attempt_started_idx"
  ON "runs" ("paid_provider_attempt_started_at")
  WHERE "paid_provider_attempt_started_at" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "app_schema_meta" (
  "id" text PRIMARY KEY,
  "schema_version" integer NOT NULL,
  "marker" text NOT NULL,
  "updated_at" timestamptz NOT NULL
);
--> statement-breakpoint

INSERT INTO "app_schema_meta" ("id", "schema_version", "marker", "updated_at")
VALUES ('current', 6, 'rfp-xray-schema-v6', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "schema_version" = EXCLUDED."schema_version",
  "marker" = EXCLUDED."marker",
  "updated_at" = EXCLUDED."updated_at";
