import { neon } from "@neondatabase/serverless";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { releaseAttestations } from "@/db/schema";

/** Kind-neutral database envelope shared by independently validated receipts. */
export interface ReleaseAttestationRow {
  kind: string;
  deployment_id: string;
  deployment_url: string;
  project_id: string;
  team_id: string;
  git_commit_sha: string;
  payload: unknown;
  payload_sha256: string;
  issued_at: Date | string;
  expires_at: Date | string;
}

/** Read one exact deployment receipt; caller owns kind-specific validation. */
export async function readReleaseAttestation(
  databaseUrl: string,
  kind: string,
  deploymentId: string
): Promise<ReleaseAttestationRow[]> {
  const db = drizzle(neon(databaseUrl));
  const rows = await db
    .select()
    .from(releaseAttestations)
    .where(and(
      eq(releaseAttestations.kind, kind),
      eq(releaseAttestations.deploymentId, deploymentId)
    ))
    .limit(1);
  return rows.map((row) => ({
    kind: row.kind,
    deployment_id: row.deploymentId,
    deployment_url: row.deploymentUrl,
    project_id: row.projectId,
    team_id: row.teamId,
    git_commit_sha: row.gitCommitSha,
    payload: row.payload,
    payload_sha256: row.payloadSha256,
    issued_at: row.issuedAt,
    expires_at: row.expiresAt
  }));
}
