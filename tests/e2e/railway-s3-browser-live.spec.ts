import { expect, test } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { sha256Hex } from "@/lib/crypto";
import {
  probeRailwayS3ReplayFence,
  RailwayS3UploadStorage,
  type RailwayS3StorageConfig
} from "@/lib/storage/railway-s3";

const LIVE_BROWSER_PROBE = process.env.RAILWAY_S3_BROWSER_LIVE_PROBE === "true";

function sanitizedLiveProbeFailure(error: unknown, stage: string) {
  const name = error instanceof Error ? error.name : "UnknownError";
  return new Error(
    `Railway S3 browser live probe failed at ${stage} (${name}); provider details were redacted.`
  );
}

test.describe("Railway S3 real Chromium-origin safety contract", () => {
  test.skip(!LIVE_BROWSER_PROBE, "Set RAILWAY_S3_BROWSER_LIVE_PROBE=true for the explicit no-paid-provider probe.");

  test("uploads once, claims and reads, signs GET, fences, deletes, and proves absence", async ({ page }) => {
    test.setTimeout(60_000);
    let stage = "configuration";
    const required = [
      "DATABASE_URL",
      "SESSION_SIGNING_SECRET",
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_CORS_ALLOWED_ORIGINS"
    ] as const;
    for (const name of required) expect(process.env[name], `${name} is required`).toBeTruthy();

    try {
    stage = "client_setup";
    const browserOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000").origin;
    const corsAllowedOrigins = process.env.S3_CORS_ALLOWED_ORIGINS!
      .split(",").map((origin) => origin.trim()).filter(Boolean);
    expect(corsAllowedOrigins).toContain(browserOrigin);

    const connection = {
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION!,
      bucket: process.env.S3_BUCKET!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: process.env.S3_URL_STYLE === "path"
    };
    const config: RailwayS3StorageConfig = {
      ...connection,
      databaseUrl: process.env.DATABASE_URL!,
      namespaceSecret: process.env.SESSION_SIGNING_SECRET!,
      MAX_OUTSTANDING_UPLOAD_GRANTS: 5,
      GUEST_UPLOAD_DOCUMENTS_PER_DAY: 15,
      API_UPLOAD_DOCUMENTS_PER_DAY: 150,
      GUEST_UPLOAD_BYTES_PER_DAY: 375 * 1024 * 1024,
      API_UPLOAD_BYTES_PER_DAY: 3_750 * 1024 * 1024,
      GLOBAL_UPLOAD_BYTES_PER_DAY: 5 * 1024 * 1024 * 1024
    };
    const storage = new RailwayS3UploadStorage(config);
    const sqlClient = neon(config.databaseUrl);
    const ownerId = `live-browser-probe:${crypto.randomUUID()}`;
    const quotaKey = `live-browser-probe:${crypto.randomUUID()}`;
    const runId = crypto.randomUUID();
    const bytes = new TextEncoder().encode(`%PDF-1.4\n% rfp-xray browser probe ${crypto.randomUUID()}\n%%EOF`);
    let blobPath: string | undefined;

    try {
      stage = "control_plane_and_replay_probe";
      const controlEvidence = await probeRailwayS3ReplayFence(connection, { corsAllowedOrigins });
      expect(controlEvidence).toMatchObject({
        bucketVersioningNeverEnabled: true,
        objectLockAbsentOrDisabled: true,
        corsContractVerified: true,
        initialUploadAccepted: true,
        replayRejected: true,
        casFenceWritten: true,
        replayAfterFenceRejected: true,
        deleteConfirmed: true
      });

      stage = "presign_browser_upload";
      const presigned = await storage.presign({
        filename: "browser-probe.pdf",
        size_bytes: bytes.byteLength,
        sha256: sha256Hex(bytes)
      }, { ownerId, quotaKey, principalKind: "guest", origin: browserOrigin });
      blobPath = presigned.blob_path;
      stage = "load_browser_origin";
      await page.goto(browserOrigin, { waitUntil: "domcontentloaded" });

      const upload = () => page.evaluate(async ({ url, method, headers, body }) => {
        const response = await fetch(url, {
          method,
          headers,
          body: new Uint8Array(body)
        });
        await response.body?.cancel();
        return response.status;
      }, {
        url: presigned.upload_url,
        method: presigned.method,
        headers: presigned.headers,
        body: [...bytes]
      });

      stage = "browser_upload";
      const firstUploadStatus = await upload();
      expect(firstUploadStatus).toBeGreaterThanOrEqual(200);
      expect(firstUploadStatus).toBeLessThan(300);
      stage = "browser_replay_rejection";
      expect([409, 412]).toContain(await upload());

      stage = "claim_uploaded_object";
      await storage.claimIncoming({
        ownerId,
        runId,
        blobPath,
        expectedSha256: sha256Hex(bytes),
        expectedSize: bytes.byteLength
      });
      stage = "server_read";
      await expect(storage.read(blobPath)).resolves.toEqual(bytes);

      stage = "browser_signed_get";
      const readUrl = await storage.temporaryReadUrl(blobPath, new Date(Date.now() + 4 * 60_000));
      const browserRead = await page.evaluate(async (url) => {
        const response = await fetch(url, { cache: "no-store" });
        return { status: response.status, body: [...new Uint8Array(await response.arrayBuffer())] };
      }, readUrl);
      expect(browserRead.status).toBe(200);
      expect(browserRead.body).toEqual([...bytes]);

      stage = "cas_fence";
      await storage.purgeIncomingToFence(blobPath, runId);
      stage = "post_fence_replay_rejection";
      expect([409, 412]).toContain(await upload());
      stage = "delete_object";
      await storage.remove(blobPath);
      stage = "confirm_absence";
      // `remove` already performs a provider HEAD absence check. A subsequent
      // public read fails one layer earlier because the ledger is fenced.
      await expect(storage.read(blobPath)).rejects.toMatchObject({ code: "UNSAFE_URL" });
    } finally {
      try {
        if (blobPath) await storage.remove(blobPath).catch(() => undefined);
        await sqlClient.transaction([
          sqlClient`DELETE FROM incoming_uploads WHERE owner_id = ${ownerId}`,
          sqlClient`DELETE FROM upload_quota_events WHERE owner_id = ${ownerId}`
        ]);
      } catch (error) {
        stage = "ledger_cleanup";
        throw error;
      }
    }
    } catch (error) {
      throw sanitizedLiveProbeFailure(error, stage);
    }
  });
});
