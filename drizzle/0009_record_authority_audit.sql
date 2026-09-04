ALTER TABLE "runs"
ADD COLUMN IF NOT EXISTS "record_authority_audit" jsonb;
--> statement-breakpoint
INSERT INTO "app_schema_meta" ("id", "schema_version", "marker", "updated_at")
VALUES ('current', 10, 'rfp-xray-schema-v10', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE
SET "schema_version" = EXCLUDED."schema_version",
    "marker" = EXCLUDED."marker",
    "updated_at" = EXCLUDED."updated_at";
