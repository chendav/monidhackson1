import { getConfig, type AppConfig } from "@/lib/config";
import { constantTimeHexEqual, sha256Hex } from "@/lib/crypto";
import { expireDueRuns } from "@/lib/runs/expiry";
import { getRunStore, type RunStore } from "@/lib/runs/store";
import { getUploadStorage, type UploadStorage } from "@/lib/storage/uploads";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

interface MaintenanceDependencies {
  config?: AppConfig;
  store?: RunStore;
  storage?: UploadStorage;
  now?: Date;
}

export function isAuthorizedMaintenanceRequest(request: Request, secret: string): boolean {
  const presented = request.headers.get("authorization") ?? "";
  return constantTimeHexEqual(
    sha256Hex(presented),
    sha256Hex(`Bearer ${secret}`)
  );
}

export async function handleMaintenance(
  request: Request,
  dependencies: MaintenanceDependencies = {}
): Promise<Response> {
  const config = dependencies.config ?? getConfig();
  if (!config.CRON_SECRET) {
    return Response.json({ error: "maintenance_unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!isAuthorizedMaintenanceRequest(request, config.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const expired = await expireDueRuns(
    dependencies.store ?? await getRunStore(),
    dependencies.storage ?? getUploadStorage(config),
    dependencies.now ?? new Date()
  );
  return Response.json({ ok: true, expired_run_count: expired.length }, { headers: NO_STORE });
}

export async function GET(request: Request) {
  return handleMaintenance(request);
}
