import { z } from "zod";
import {
  MAX_RECORD_AUTHORITY_RECEIPT_BYTES,
  RECORD_AUTHORITY_VERSION,
  recordAuthorityManifestIntegrity,
  unresolvedRecordAuthority,
  type VerifiedRecordAuthorityManifest
} from "@/lib/analysis/record-authority";

export const RecordAuthorityAuditSchema = z.object({
  version: z.union([z.literal(1), z.literal(RECORD_AUTHORITY_VERSION)]),
  manifest_digest: z.string().regex(/^[a-f0-9]{64}$/),
  receipt_byte_length: z.number().int().nonnegative()
    .max(MAX_RECORD_AUTHORITY_RECEIPT_BYTES),
  receipt_limit_bytes: z.literal(MAX_RECORD_AUTHORITY_RECEIPT_BYTES),
  record_count: z.number().int().nonnegative(),
  complete: z.boolean(),
  recorded_at: z.string().datetime({ offset: true })
}).strict();

export type RecordAuthorityAudit = z.infer<typeof RecordAuthorityAuditSchema>;

/**
 * Persist only the bounded server receipt measurements and its integrity
 * digest. Never persist the receipt, source evidence, or model output here.
 */
export function createRecordAuthorityAudit(
  manifest: VerifiedRecordAuthorityManifest | null | undefined,
  recordedAt = new Date()
): RecordAuthorityAudit {
  const verified = manifest && recordAuthorityManifestIntegrity(manifest)
    ? manifest
    : unresolvedRecordAuthority(manifest
      ? "unverified_record_authority_audit"
      : "missing_record_authority_audit");
  return RecordAuthorityAuditSchema.parse({
    version: verified.version,
    manifest_digest: verified.record_manifest_digest,
    receipt_byte_length: verified.receipt_byte_length,
    receipt_limit_bytes: verified.receipt_capacity_bytes,
    record_count: verified.records.length,
    complete: verified.complete && !verified.package_veto,
    recorded_at: recordedAt.toISOString()
  });
}
