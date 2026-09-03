import { neon } from "@neondatabase/serverless";
import type { QuestionResponse } from "@/contracts";
import { getConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";

export const MAX_QUESTIONS_PER_RUN = 10;

export interface QuestionAuditInput {
  runId: string;
  questionSha256: string;
  answerability: QuestionResponse["answerability"];
  citationCount: number;
  now?: Date;
}

export interface QuestionAuditStore {
  record(input: QuestionAuditInput): Promise<void>;
}

export class InMemoryQuestionAuditStore implements QuestionAuditStore {
  private readonly counts = new Map<string, number>();

  async record(input: QuestionAuditInput): Promise<void> {
    const count = this.counts.get(input.runId) ?? 0;
    if (count >= MAX_QUESTIONS_PER_RUN) {
      throw new AppError("RATE_LIMITED", "The per-run question limit has been reached.", {
        httpStatus: 429
      });
    }
    // There is no await before this write, so each mutation is atomic within
    // the JavaScript event loop used by the local fallback.
    this.counts.set(input.runId, count + 1);
  }

  clear() {
    this.counts.clear();
  }
}

export class NeonQuestionAuditStore implements QuestionAuditStore {
  private readonly sql;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  async record(input: QuestionAuditInput): Promise<void> {
    const id = crypto.randomUUID();
    const now = input.now ?? new Date();
    const results = await this.sql.transaction([
      this.sql`SELECT pg_advisory_xact_lock(hashtext(${`rfp-xray-question:${input.runId}`}))`,
      this.sql`
        INSERT INTO question_audits
          (id, run_id, question_sha256, answerability, citation_count, created_at)
        SELECT
          ${id}::uuid,
          ${input.runId}::uuid,
          ${input.questionSha256},
          ${input.answerability},
          ${input.citationCount},
          ${now.toISOString()}::timestamptz
        WHERE (
          SELECT COUNT(*) FROM question_audits WHERE run_id = ${input.runId}::uuid
        ) < ${MAX_QUESTIONS_PER_RUN}
        RETURNING id
      `
    ]);
    const rows = results[1] as unknown as Array<{ id: string }>;
    if (!rows[0]) {
      throw new AppError("RATE_LIMITED", "The per-run question limit has been reached.", {
        httpStatus: 429
      });
    }
  }
}

let override: QuestionAuditStore | undefined;
let memory: InMemoryQuestionAuditStore | undefined;
let neonStore: NeonQuestionAuditStore | undefined;

export function setQuestionAuditStoreForTests(store: QuestionAuditStore | undefined) {
  override = store;
}

export function getQuestionAuditStore(): QuestionAuditStore {
  if (override) return override;
  const config = getConfig();
  if (config.DATABASE_URL) {
    neonStore ??= new NeonQuestionAuditStore(config.DATABASE_URL);
    return neonStore;
  }
  if (config.NODE_ENV === "production") {
    throw new AppError("ANALYSIS_INCOMPLETE", "Persistent question auditing is not configured.", {
      httpStatus: 503,
      retryable: true
    });
  }
  memory ??= new InMemoryQuestionAuditStore();
  return memory;
}

export function resetQuestionAuditStoreForTests() {
  memory?.clear();
  memory = undefined;
  neonStore = undefined;
  override = undefined;
}
