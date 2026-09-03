ALTER TABLE "runs" ALTER COLUMN "input" DROP NOT NULL;
ALTER TABLE "runs" ALTER COLUMN "request_hash" DROP NOT NULL;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "processing_lease_id" uuid;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "processing_lease_expires_at" timestamptz;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "processing_fence" integer NOT NULL DEFAULT 0;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "terminal_after_cleanup" text;
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "audit_expires_at" timestamptz;
CREATE INDEX IF NOT EXISTS "runs_audit_expires_at_idx" ON "runs" ("audit_expires_at");
CREATE INDEX IF NOT EXISTS "runs_processing_lease_expiry_idx" ON "runs" ("processing_lease_expires_at");

CREATE TABLE IF NOT EXISTS "incoming_uploads" (
  "blob_path" text PRIMARY KEY,
  "owner_id" text NOT NULL,
  "expected_sha256" text NOT NULL,
  "expected_size" integer NOT NULL,
  "status" text NOT NULL,
  "claimed_run_id" uuid,
  "source_etag" text,
  "stage_path" text,
  "stage_etag" text,
  "fence_etag" text,
  "lease_id" uuid,
  "lease_expires_at" timestamptz,
  "version" integer NOT NULL DEFAULT 0,
  "cleanup_attempts" integer NOT NULL DEFAULT 0,
  "last_cleanup_error_code" text,
  "expires_at" timestamptz NOT NULL,
  "cleanup_due_at" timestamptz NOT NULL,
  "hard_delete_by" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "incoming_uploads_expiry_idx" ON "incoming_uploads" ("expires_at");
CREATE INDEX IF NOT EXISTS "incoming_uploads_cleanup_due_idx" ON "incoming_uploads" ("cleanup_due_at");
CREATE INDEX IF NOT EXISTS "incoming_uploads_owner_idx" ON "incoming_uploads" ("owner_id");
