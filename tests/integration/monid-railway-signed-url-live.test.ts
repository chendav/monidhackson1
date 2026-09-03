import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import { MonidAdapter } from "@/lib/providers/monid";

const LIVE_PROBE_ENABLED = process.env.MONID_RAILWAY_LIVE_PROBE === "true";
const EDMONTON_SHA256 = "2a769c87c80d5e958b0c99d0bd0107b34cfbeddb9bb0c15c2f2b3dc609adc9c6";

function isNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NotFound" || candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404;
}

describe.skipIf(!LIVE_PROBE_ENABLED)("Monid and Railway signed-URL live contract", () => {
  it("lets Context.dev fetch a five-minute private object and confirms cleanup", async () => {
    const required = [
      "EDMONTON_PDF_PATH",
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "MONID_API_KEY",
      "MONID_PARSE_PROVIDER",
      "MONID_PARSE_ENDPOINT",
      "MONID_RUN_ID_PATH",
      "MONID_RUN_STATUS_PATH",
      "MONID_PROVIDER_STATUS_PATH",
      "MONID_RESULT_URL_PATH",
      "MONID_COST_VALUE_PATH",
      "MONID_COST_CURRENCY_PATH",
      "MONID_COST_VALUE_UNIT",
      "MONID_INSPECT_SCHEMA_SHA256",
      "MONID_ARTIFACT_HOST_ALLOWLIST"
    ] as const;
    for (const name of required) {
      expect(process.env[name], `${name} must be set for the explicit paid live probe`).toBeTruthy();
    }

    const source = await readFile(process.env.EDMONTON_PDF_PATH!);
    expect(createHash("sha256").update(source).digest("hex")).toBe(EDMONTON_SHA256);
    const key = `probe/monid-signed-url/${crypto.randomUUID()}.pdf`;
    const client = new S3Client({
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION!,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!
      },
      forcePathStyle: process.env.S3_URL_STYLE === "path",
      maxAttempts: 1
    });
    let uploadSucceeded = false;
    let uploadedEtag: string | undefined;
    let cleanupConfirmed = false;
    const startedAt = Date.now();

    try {
      const uploadUrl = await getSignedUrl(client, new PutObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: key,
        ContentType: "application/pdf",
        ContentLength: source.byteLength,
        IfNoneMatch: "*"
      }), {
        expiresIn: 300,
        signableHeaders: new Set(["content-length", "content-type", "if-none-match"])
      });
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "content-type": "application/pdf",
          "content-length": String(source.byteLength),
          "if-none-match": "*"
        },
        body: Uint8Array.from(source).buffer
      });
      expect(uploadResponse.status).toBeGreaterThanOrEqual(200);
      expect(uploadResponse.status).toBeLessThan(300);
      uploadSucceeded = true;
      await uploadResponse.body?.cancel();
      const uploaded = await client.send(new HeadObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: key
      }));
      uploadedEtag = uploaded.ETag;
      expect(uploadedEtag).toBeTruthy();

      const readableUrl = await getSignedUrl(client, new GetObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: key,
        ResponseCacheControl: "private, no-store"
      }), { expiresIn: 300 });
      expect(new URL(readableUrl).protocol).toBe("https:");

      const result = await new MonidAdapter({
        config: getConfig(),
        pollIntervalMs: 500,
        maxPolls: 120
      }).parse({ fileUrl: readableUrl, extension: "pdf", ocr: false });

      expect(result.markdown.length).toBeGreaterThan(100_000);
      expect(result.markdown).toContain("M1");
      expect(result.markdown).toContain("M4");
      expect(result.markdown.toLowerCase()).toContain("lowest evaluated price");
      expect(result.costAmount).toBe(0.0009);
      expect(result.costCurrency).toBe("USD");
      expect(result.costValueUnit).toBe("currency_major");
      expect(result.costProvenance).toMatchObject({
        kind: "credentialed_inspect",
        inspect_schema_sha256: process.env.MONID_INSPECT_SCHEMA_SHA256,
        value_path: "cost.value",
        currency_path: "cost.currency",
        source_value: 0.0009,
        source_currency: "USD"
      });

      console.info("MONID_RAILWAY_LIVE_PROBE", JSON.stringify({
        verdict: "pass",
        source_sha256: EDMONTON_SHA256,
        source_bytes: source.byteLength,
        signed_url_ttl_seconds: 300,
        provider: process.env.MONID_PARSE_PROVIDER,
        endpoint: process.env.MONID_PARSE_ENDPOINT,
        run_id: result.runId,
        cost_micro_usd: 900,
        markdown_bytes: Buffer.byteLength(result.markdown),
        markdown_sha256: createHash("sha256").update(result.markdown).digest("hex"),
        elapsed_ms_before_cleanup: Date.now() - startedAt,
        provider_retention: "upstream artifact observed with seven-day expiry; ZDR unavailable"
      }));
    } finally {
      if (uploadSucceeded) {
        await client.send(new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET!,
          Key: key,
          ...(uploadedEtag ? { IfMatch: uploadedEtag } : {})
        }));
      }
      try {
        await client.send(new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET!,
          Key: key
        }));
      } catch (error) {
        if (isNotFound(error)) cleanupConfirmed = true;
        else throw error;
      }
      expect(cleanupConfirmed).toBe(true);
      console.info("MONID_RAILWAY_LIVE_CLEANUP", JSON.stringify({
        cleanup_confirmed: cleanupConfirmed,
        elapsed_ms_total: Date.now() - startedAt
      }));
    }
  }, 90_000);
});
