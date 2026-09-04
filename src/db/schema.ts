import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AnalysisResult, CostEvent, CreateRunRequest, DocumentManifest } from "@/contracts";
import type { QuoteVerificationReceipt } from "@/lib/evidence/citations";
import type { RecordAuthorityAudit } from "@/lib/runs/record-authority-audit";
import type { SubmissionAdjudicationAudit } from "@/lib/runs/submission-adjudication-audit";
import type {
  AnalysisDispatchStatus,
  CleanupReceipt,
  CleanupRetryDispatchStatus,
  RunFailure,
  SourceCleanupWatchdog
} from "@/lib/runs/types";

export const APP_SCHEMA_VERSION = 11;
export const APP_SCHEMA_MARKER = "rfp-xray-schema-v11";

export const appSchemaMeta = pgTable("app_schema_meta", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull(),
  marker: text("marker").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const maintenanceHeartbeats = pgTable("maintenance_heartbeats", {
  id: text("id").primaryKey(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  workBudgetMs: integer("work_budget_ms").notNull(),
  recoveredRunCount: integer("recovered_run_count").notNull(),
  admissionFailureCount: integer("admission_failure_count").notNull(),
  admissionDeferredCount: integer("admission_deferred_count").notNull(),
  expiredRunCount: integer("expired_run_count").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

/**
 * Non-secret release receipts share this deployment-bound envelope. The
 * `kind` discriminator leaves room for a later, independently verified
 * provider-contract receipt without weakening the Workflow runtime gate.
 */
export const releaseAttestations = pgTable(
  "release_attestations",
  {
    kind: text("kind").notNull(),
    deploymentId: text("deployment_id").notNull(),
    deploymentUrl: text("deployment_url").notNull(),
    projectId: text("project_id").notNull(),
    teamId: text("team_id").notNull(),
    gitCommitSha: text("git_commit_sha").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.deploymentId] }),
    index("release_attestations_kind_issued_idx").on(table.kind, table.issuedAt)
  ]
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    quotaKey: text("quota_key").notNull(),
    input: jsonb("input").$type<CreateRunRequest | null>(),
    requestHash: text("request_hash"),
    idempotencyKey: text("idempotency_key"),
    status: text("status").notNull(),
    stage: text("stage").notNull(),
    progress: integer("progress").notNull(),
    cleanupConfirmed: boolean("cleanup_confirmed").notNull().default(false),
    cleanupExpectedResourceIds: jsonb("cleanup_expected_resource_ids").$type<string[]>().notNull(),
    cleanupReceipts: jsonb("cleanup_receipts").$type<CleanupReceipt[]>().notNull(),
    sourceCleanupWatchdogs: jsonb("source_cleanup_watchdogs")
      .$type<SourceCleanupWatchdog[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    paidProviderAttemptStartedAt: timestamp("paid_provider_attempt_started_at", { withTimezone: true }),
    citationReceipts: jsonb("citation_receipts").$type<QuoteVerificationReceipt[]>().notNull(),
    manifests: jsonb("manifests").$type<DocumentManifest[]>().notNull(),
    costs: jsonb("costs").$type<CostEvent[]>().notNull(),
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    reservedMicroUsd: integer("reserved_micro_usd").notNull().default(0),
    result: jsonb("result").$type<AnalysisResult>(),
    recordAuthorityAudit: jsonb("record_authority_audit").$type<RecordAuthorityAudit>(),
    submissionAdjudicationAudit: jsonb("submission_adjudication_audit")
      .$type<SubmissionAdjudicationAudit>(),
    error: jsonb("error").$type<RunFailure>(),
    workflowRunId: text("workflow_run_id"),
    analysisDispatchClaimId: uuid("analysis_dispatch_claim_id"),
    analysisDispatchClaimedAt: timestamp("analysis_dispatch_claimed_at", { withTimezone: true }),
    analysisDispatchStatus: text("analysis_dispatch_status").$type<AnalysisDispatchStatus>(),
    analysisDispatchUncertainAt: timestamp("analysis_dispatch_uncertain_at", {
      withTimezone: true
    }),
    cleanupRetryClaimId: uuid("cleanup_retry_claim_id"),
    cleanupRetryClaimedAt: timestamp("cleanup_retry_claimed_at", { withTimezone: true }),
    cleanupRetryWorkflowRunId: text("cleanup_retry_workflow_run_id"),
    cleanupRetryDispatchStatus: text("cleanup_retry_dispatch_status")
      .$type<CleanupRetryDispatchStatus>(),
    cleanupRetryDispatchUncertainAt: timestamp("cleanup_retry_dispatch_uncertain_at", {
      withTimezone: true
    }),
    admissionLeaseId: uuid("admission_lease_id"),
    admissionLeaseExpiresAt: timestamp("admission_lease_expires_at", { withTimezone: true }),
    processingLeaseId: uuid("processing_lease_id"),
    processingLeaseExpiresAt: timestamp("processing_lease_expires_at", { withTimezone: true }),
    processingFence: integer("processing_fence").notNull().default(0),
    terminalAfterCleanup: text("terminal_after_cleanup"),
    auditExpiresAt: timestamp("audit_expires_at", { withTimezone: true }),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("runs_owner_idempotency_unique").on(table.ownerId, table.idempotencyKey),
    uniqueIndex("runs_owner_active_unique")
      .on(table.ownerId)
      .where(sql`${table.status} IN ('queued', 'validating', 'staging', 'page_indexing', 'parsing', 'purging_source', 'extracting', 'reconciling', 'verifying', 'cleanup_pending')`),
    index("runs_expires_at_idx").on(table.expiresAt),
    index("runs_audit_expires_at_idx").on(table.auditExpiresAt),
    index("runs_processing_lease_expiry_idx").on(table.processingLeaseExpiresAt),
    index("runs_queued_admission_idx")
      .on(table.updatedAt)
      .where(sql`${table.status} = 'queued'`),
    index("runs_analysis_dispatch_recovery_idx")
      .on(table.analysisDispatchClaimedAt)
      .where(sql`${table.status} = 'queued' AND ${table.analysisDispatchClaimId} IS NOT NULL`),
    index("runs_cleanup_retry_uncertain_idx")
      .on(table.cleanupRetryDispatchUncertainAt)
      .where(sql`${table.status} = 'cleanup_pending' AND ${table.cleanupRetryDispatchUncertainAt} IS NOT NULL`),
    index("runs_cleanup_pending_updated_idx")
      .on(table.updatedAt)
      .where(sql`${table.status} = 'cleanup_pending'`),
    index("runs_cleanup_retry_dispatching_idx")
      .on(table.cleanupRetryClaimedAt)
      .where(sql`${table.status} = 'cleanup_pending' AND ${table.cleanupRetryDispatchStatus} = 'dispatching'`),
    index("runs_quota_created_idx").on(table.quotaKey, table.createdAt)
  ]
);

export const incomingUploads = pgTable(
  "incoming_uploads",
  {
    blobPath: text("blob_path").primaryKey(),
    ownerId: text("owner_id").notNull(),
    expectedSha256: text("expected_sha256").notNull(),
    expectedSize: integer("expected_size").notNull(),
    status: text("status").notNull(),
    claimedRunId: uuid("claimed_run_id"),
    sourceEtag: text("source_etag"),
    stagePath: text("stage_path"),
    stageEtag: text("stage_etag"),
    fenceEtag: text("fence_etag"),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    version: integer("version").notNull().default(0),
    cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
    lastCleanupErrorCode: text("last_cleanup_error_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    cleanupDueAt: timestamp("cleanup_due_at", { withTimezone: true }).notNull(),
    hardDeleteBy: timestamp("hard_delete_by", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    index("incoming_uploads_expiry_idx").on(table.expiresAt),
    index("incoming_uploads_cleanup_due_idx").on(table.cleanupDueAt),
    index("incoming_uploads_owner_idx").on(table.ownerId)
  ]
);

export const uploadQuotaEvents = pgTable(
  "upload_quota_events",
  {
    id: uuid("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    quotaKey: text("quota_key").notNull(),
    principalKind: text("principal_kind").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    day: text("day").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull()
  },
  (table) => [
    index("upload_quota_events_quota_day_idx").on(table.quotaKey, table.day),
    index("upload_quota_events_day_idx").on(table.day),
    index("upload_quota_events_created_at_idx").on(table.createdAt)
  ]
);

export const runDocuments = pgTable(
  "run_documents",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    role: text("role").notNull(),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url"),
    blobPath: text("blob_path"),
    sha256: text("sha256").notNull(),
    pages: integer("pages").notNull(),
    cleanupStatus: text("cleanup_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull()
  },
  (table) => [index("run_documents_run_idx").on(table.runId), index("run_documents_sha_idx").on(table.sha256)]
);

export const budgetReservations = pgTable(
  "budget_reservations",
  {
    runId: uuid("run_id").primaryKey().references(() => runs.id, { onDelete: "cascade" }),
    quotaKey: text("quota_key").notNull(),
    day: text("day").notNull(),
    reservedMicroUsd: integer("reserved_micro_usd").notNull(),
    settledMicroUsd: integer("settled_micro_usd"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true })
  },
  (table) => [index("budget_reservations_day_idx").on(table.day)]
);

export const questionAudits = pgTable(
  "question_audits",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    questionSha256: text("question_sha256").notNull(),
    answerability: text("answerability").notNull(),
    citationCount: integer("citation_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull()
  },
  (table) => [index("question_audits_run_idx").on(table.runId)]
);
