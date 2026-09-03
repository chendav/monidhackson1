CREATE TABLE IF NOT EXISTS "upload_quota_events" (
  "id" uuid PRIMARY KEY,
  "owner_id" text NOT NULL,
  "quota_key" text NOT NULL,
  "principal_kind" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "day" text NOT NULL,
  "created_at" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "upload_quota_events_quota_day_idx"
  ON "upload_quota_events" ("quota_key", "day");
CREATE INDEX IF NOT EXISTS "upload_quota_events_day_idx"
  ON "upload_quota_events" ("day");
