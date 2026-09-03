CREATE TABLE IF NOT EXISTS "runs" (
  "id" uuid PRIMARY KEY,
  "owner_id" text NOT NULL,
  "quota_key" text NOT NULL,
  "input" jsonb,
  "request_hash" text,
  "idempotency_key" text,
  "status" text NOT NULL,
  "stage" text NOT NULL,
  "progress" integer NOT NULL,
  "cleanup_confirmed" boolean NOT NULL DEFAULT false,
  "cleanup_expected_resource_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "cleanup_receipts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "citation_receipts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "manifests" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "costs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "cost_micro_usd" integer NOT NULL DEFAULT 0,
  "reserved_micro_usd" integer NOT NULL DEFAULT 0,
  "result" jsonb,
  "error" jsonb,
  "workflow_run_id" text,
  "processing_lease_id" uuid,
  "processing_lease_expires_at" timestamptz,
  "processing_fence" integer NOT NULL DEFAULT 0,
  "terminal_after_cleanup" text,
  "audit_expires_at" timestamptz,
  "version" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "runs_owner_idempotency_unique"
  ON "runs" ("owner_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "runs_owner_active_unique"
  ON "runs" ("owner_id")
  WHERE "status" IN ('queued', 'validating', 'staging', 'page_indexing', 'parsing', 'purging_source', 'extracting', 'reconciling', 'verifying', 'cleanup_pending');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_expires_at_idx" ON "runs" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_audit_expires_at_idx" ON "runs" ("audit_expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_quota_created_idx" ON "runs" ("quota_key", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "run_documents" (
  "id" uuid PRIMARY KEY,
  "run_id" uuid NOT NULL REFERENCES "runs"("id") ON DELETE CASCADE,
  "source_type" text NOT NULL,
  "role" text NOT NULL,
  "source_name" text NOT NULL,
  "source_url" text,
  "blob_path" text,
  "sha256" text NOT NULL,
  "pages" integer NOT NULL,
  "cleanup_status" text NOT NULL,
  "created_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_documents_run_idx" ON "run_documents" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_documents_sha_idx" ON "run_documents" ("sha256");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "budget_reservations" (
  "run_id" uuid PRIMARY KEY REFERENCES "runs"("id") ON DELETE CASCADE,
  "quota_key" text NOT NULL,
  "day" text NOT NULL,
  "reserved_micro_usd" integer NOT NULL,
  "settled_micro_usd" integer,
  "created_at" timestamptz NOT NULL,
  "settled_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_reservations_day_idx" ON "budget_reservations" ("day");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "question_audits" (
  "id" uuid PRIMARY KEY,
  "run_id" uuid NOT NULL REFERENCES "runs"("id") ON DELETE CASCADE,
  "question_sha256" text NOT NULL,
  "answerability" text NOT NULL,
  "citation_count" integer NOT NULL,
  "created_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "question_audits_run_idx" ON "question_audits" ("run_id");
--> statement-breakpoint

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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incoming_uploads_expiry_idx" ON "incoming_uploads" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incoming_uploads_owner_idx" ON "incoming_uploads" ("owner_id");
