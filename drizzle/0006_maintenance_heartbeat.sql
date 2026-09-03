CREATE TABLE IF NOT EXISTS "maintenance_heartbeats" (
  "id" text PRIMARY KEY,
  "completed_at" timestamptz NOT NULL,
  "duration_ms" integer NOT NULL CHECK ("duration_ms" >= 0 AND "duration_ms" <= 50000),
  "work_budget_ms" integer NOT NULL CHECK ("work_budget_ms" > 0 AND "work_budget_ms" <= 45000),
  "recovered_run_count" integer NOT NULL CHECK ("recovered_run_count" >= 0),
  "admission_failure_count" integer NOT NULL CHECK ("admission_failure_count" >= 0),
  "admission_deferred_count" integer NOT NULL CHECK ("admission_deferred_count" >= 0),
  "expired_run_count" integer NOT NULL CHECK ("expired_run_count" >= 0),
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "maintenance_heartbeats_duration_within_budget"
    CHECK ("duration_ms" <= "work_budget_ms")
);
--> statement-breakpoint

INSERT INTO "app_schema_meta" ("id", "schema_version", "marker", "updated_at")
VALUES ('current', 7, 'rfp-xray-schema-v7', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "schema_version" = EXCLUDED."schema_version",
  "marker" = EXCLUDED."marker",
  "updated_at" = EXCLUDED."updated_at";
