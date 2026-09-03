import { jsonResponse } from "@/lib/api/http";
import {
  getConfig,
  getPrivateStorageProvider,
  getProductionReadiness,
  getRailwayS3SafetyStatus,
  hasLivePipelineConfig
} from "@/lib/config";
import { probeDatabaseSchema } from "@/lib/health/database";
import { probeMaintenanceHeartbeat } from "@/lib/health/maintenance";
import { probeProviderContractsAttestation } from "@/lib/health/provider-contracts";
import { probeWorkflowRuntimeAttestation } from "@/lib/health/workflow-runtime";

export const runtime = "nodejs";

export async function GET() {
  const config = getConfig();
  const livePipeline = hasLivePipelineConfig(config);
  const readiness = getProductionReadiness(config);
  const privateStorageProvider = getPrivateStorageProvider(config);
  const [database, maintenance, workflowRuntime, providerContracts] = await Promise.all([
    config.DATABASE_URL
      ? probeDatabaseSchema(config.DATABASE_URL)
      : Promise.resolve({
          status: config.NODE_ENV === "production" ? "missing" as const : "memory_fallback" as const
        }),
    config.NODE_ENV === "production"
      ? probeMaintenanceHeartbeat(config.DATABASE_URL)
      : Promise.resolve({ status: "not_applicable" as const }),
    config.NODE_ENV === "production"
      ? probeWorkflowRuntimeAttestation(config.DATABASE_URL)
      : Promise.resolve({ status: "microtask_fallback" as const }),
    config.NODE_ENV === "production"
      ? probeProviderContractsAttestation(config.DATABASE_URL, config)
      : Promise.resolve({ status: "configured_unattested" as const })
  ]);
  const railwaySafety = privateStorageProvider === "railway_s3"
    ? getRailwayS3SafetyStatus(config)
    : null;
  const storageSafety = privateStorageProvider === "railway_s3"
    ? railwaySafety?.valid
      ? "current" as const
      : railwaySafety?.reason === "missing"
        ? "missing" as const
        : railwaySafety?.reason === "expired"
          ? "expired" as const
          : "invalid" as const
    : privateStorageProvider === "vercel_blob"
      ? config.BLOB_REPLAY_FENCE_VALIDATED ? "current" as const : "invalid" as const
      : config.NODE_ENV === "production" ? "missing" as const : "not_applicable" as const;
  const activeReady = database.status === "ready" && storageSafety === "current" &&
    maintenance.status === "fresh" && workflowRuntime.status === "attested_300s" &&
    providerContracts.status === "actively_verified";
  const status = config.NODE_ENV === "production"
    ? (readiness.ready && livePipeline && activeReady ? "ok" : "not_ready")
    : (livePipeline ? "ok" : "degraded");
  const missing = [...readiness.missing];
  if (config.NODE_ENV === "production" && database.status !== "ready") {
    missing.push("DATABASE_SCHEMA_READY");
  }
  if (config.NODE_ENV === "production" && maintenance.status !== "fresh") {
    missing.push("MAINTENANCE_HEARTBEAT_FRESH");
  }
  if (config.NODE_ENV === "production" && workflowRuntime.status !== "attested_300s") {
    missing.push(workflowRuntime.status === "configured_unattested"
      ? "WORKFLOW_RUNTIME_ATTESTATION"
      : workflowRuntime.status === "expired"
        ? "WORKFLOW_RUNTIME_ATTESTATION_FRESH"
        : "WORKFLOW_RUNTIME_ATTESTATION_MATCH");
  }
  if (config.NODE_ENV === "production" && providerContracts.status !== "actively_verified") {
    missing.push(providerContracts.status === "configured_unattested"
      ? "PROVIDER_CONTRACT_ATTESTATION"
      : providerContracts.status === "expired"
        ? "PROVIDER_CONTRACT_ATTESTATION_FRESH"
        : "PROVIDER_CONTRACT_ATTESTATION_MATCH");
  }
  const productionProviderState = providerContracts.status;
  return jsonResponse({
    status,
    version: "1.0",
    mode: status === "not_ready" ? "unavailable" : livePipeline ? "live" : "local_fallback",
    dependencies: {
      database: database.status,
      maintenance: maintenance.status,
      private_storage: privateStorageProvider
        ? storageSafety === "current" ? "attested" : "configured"
        : config.NODE_ENV === "production" ? "missing" : "memory_fallback",
      workflow: workflowRuntime.status,
      monid: livePipeline
        ? config.NODE_ENV === "production" ? productionProviderState : "configured_unverified"
        : config.MONID_API_KEY ? "configured" : config.NODE_ENV === "production" ? "missing" : "local_fallback",
      openai: config.OPENAI_API_KEY
        ? config.NODE_ENV === "production" && livePipeline
          ? productionProviderState
          : "configured_unverified"
        : config.NODE_ENV === "production" ? "missing" : "local_fallback"
    },
    storage_provider: privateStorageProvider ?? (config.NODE_ENV === "production" ? "missing" : "memory"),
    storage_safety: storageSafety,
    limits: {
      max_run_cost_micro_usd: config.MAX_RUN_COST_MICRO_USD,
      daily_cost_cap_micro_usd: config.DAILY_COST_CAP_MICRO_USD
    },
    missing: [...new Set(missing)],
    source_scope: "document_only",
    provider_retention: "unknown"
  }, { status: status === "not_ready" ? 503 : 200 });
}
