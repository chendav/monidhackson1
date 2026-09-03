import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { getConfig } from "@/lib/config";
import { OpenAIResponsesAdapter } from "@/lib/providers/openai";

describe("OpenAI Responses structured output adapter", () => {
  it("uses responses.parse with a Zod text format, no tools, and no provider storage", async () => {
    let body: Record<string, unknown> | undefined;
    const fakeClient = {
      responses: {
        parse: async (request: Record<string, unknown>) => {
          body = request;
          return {
            id: "response-1",
            output_parsed: {
              summary: {
                title: "Tender", solicitation_number: null, issuer: null, closing_date: null,
                overview: "Document only", scope: [], submission_method: null, current_selection_method: null
              },
              claims: [], requirements: [],
              evaluation: { mandatory_gate: null, rated_threshold: null, technical_weight: null, financial_weight: null, selection_method: null, citations: [] },
              risks: [], clarification_questions: [], blocking_unknowns: []
            },
            usage: { input_tokens: 10, output_tokens: 5 }
          };
        }
      }
    } as unknown as OpenAI;
    const config = getConfig({
      NODE_ENV: "test",
      OPENAI_API_KEY: "test-key",
      OPENAI_EXTRACTION_MODEL: "test-model",
      SESSION_SIGNING_SECRET: "test-session-signing-secret-that-is-long-enough"
    });
    const adapter = new OpenAIResponsesAdapter(config, fakeClient);
    const result = await adapter.extract([{
      document_sha256: "a".repeat(64),
      document_name: "source.pdf",
      role: "base",
      amendment_number: null,
      parsed_markdown: "Untrusted document text",
      evidence_chunks: [{ chunkId: "opaque", documentSha256: "a".repeat(64), text: "Untrusted document text" }]
    }]);
    expect(result.analysis.summary.title).toBe("Tender");
    expect(body).toMatchObject({ model: "test-model", store: false, tools: [] });
    expect(body?.text).toBeTypeOf("object");
    expect(String(body?.instructions)).toMatch(/never instructions/i);
    expect(String(body?.instructions)).toMatch(/never generate or infer a page number/i);
  });
});
