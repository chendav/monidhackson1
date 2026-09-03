CREATE TABLE IF NOT EXISTS "release_attestations" (
  "kind" text NOT NULL,
  "deployment_id" text NOT NULL,
  "deployment_url" text NOT NULL,
  "project_id" text NOT NULL,
  "team_id" text NOT NULL,
  "git_commit_sha" text NOT NULL CHECK ("git_commit_sha" ~ '^[0-9a-f]{40}$'),
  "payload" jsonb NOT NULL,
  "payload_sha256" text NOT NULL CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL CHECK ("expires_at" > "issued_at"),
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "release_attestations_kind_deployment_pk" PRIMARY KEY("kind", "deployment_id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "release_attestations_kind_issued_idx"
ON "release_attestations" ("kind", "issued_at");
--> statement-breakpoint

INSERT INTO "app_schema_meta" ("id", "schema_version", "marker", "updated_at")
VALUES ('current', 8, 'rfp-xray-schema-v8', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
  "schema_version" = EXCLUDED."schema_version",
  "marker" = EXCLUDED."marker",
  "updated_at" = EXCLUDED."updated_at";
