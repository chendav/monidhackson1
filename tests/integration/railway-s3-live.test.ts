import { describe, expect, it } from "vitest";
import { probeRailwayS3ReplayFence } from "@/lib/storage/railway-s3";
import { inspectRailwayS3SafetyAttestation } from "@/lib/storage/railway-s3-safety";

const LIVE_PROBE_ENABLED = process.env.RAILWAY_S3_LIVE_PROBE === "true";

describe.skipIf(!LIVE_PROBE_ENABLED)("Railway S3 live replay-fence contract", () => {
  it("rejects signed PUT replay, writes a CAS fence, and confirms deletion", async () => {
    const required = [
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_CORS_ALLOWED_ORIGINS"
    ] as const;
    for (const name of required) {
      expect(process.env[name], `${name} must be set for the explicit live probe`).toBeTruthy();
    }

    const target = {
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION!,
      bucket: process.env.S3_BUCKET!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: process.env.S3_URL_STYLE === "path"
    };
    const corsAllowedOrigins = process.env.S3_CORS_ALLOWED_ORIGINS!.split(",").map((value) => value.trim());
    const result = await probeRailwayS3ReplayFence(target, { corsAllowedOrigins });
    expect(result).toMatchObject({
      initialUploadAccepted: true,
      replayRejected: true,
      exactSizeStored: true,
      casFenceWritten: true,
      replayAfterFenceRejected: true,
      deleteConfirmed: true,
      bucketVersioningNeverEnabled: true,
      objectLockAbsentOrDisabled: true,
      corsContractVerified: true
    });
    expect(inspectRailwayS3SafetyAttestation(
      result.safetyAttestation,
      target,
      corsAllowedOrigins
    )).toMatchObject({ valid: true });
  }, 30_000);
});
