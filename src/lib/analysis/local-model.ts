import type { DraftAnalysis } from "@/lib/analysis/draft";
import type {
  AnalysisModel,
  ExtractionCallResult,
  ModelDocumentInput,
  QuestionCallResult
} from "@/lib/providers/openai";

function sentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;:])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 20 && item.length <= 450);
}

function firstEvidence(document: ModelDocumentInput) {
  for (const chunk of document.evidence_chunks) {
    const sentence = sentences(chunk.text)[0];
    if (sentence) {
      return {
        document_sha256: document.document_sha256,
        chunk_id: chunk.chunkId,
        evidence_quote: sentence,
        section: null
      };
    }
  }
  return null;
}

export class LocalDeterministicModel implements AnalysisModel {
  async extract(documents: ModelDocumentInput[]): Promise<ExtractionCallResult> {
    const started = performance.now();
    const claims: DraftAnalysis["claims"] = [];
    const requirements: DraftAnalysis["requirements"] = [];
    for (const [index, document] of documents.entries()) {
      const evidence = firstEvidence(document);
      if (!evidence) continue;
      claims.push({
        claim_id: `document-${index + 1}-scope`,
        topic: `document-${index + 1}-scope`,
        claim_text: evidence.evidence_quote,
        claim_type: "source",
        confidence: 1,
        document_sha256: document.document_sha256,
        amendment_number: document.amendment_number,
        effect: document.role === "amendment" ? "replace" : "add",
        citations: [evidence],
        supersedes_claim_ids: []
      });
      const mandatory = document.evidence_chunks.flatMap((chunk) =>
        sentences(chunk.text)
          .filter((sentence) => /\b(?:must|shall|required)\b/i.test(sentence))
          .slice(0, 3)
          .map((sentence) => ({ chunk, sentence }))
      ).slice(0, 8);
      mandatory.forEach(({ chunk, sentence }, requirementIndex) => requirements.push({
        id: `${document.document_sha256.slice(0, 8)}-req-${requirementIndex + 1}`,
        topic: sentence.slice(0, 100),
        document_sha256: document.document_sha256,
        amendment_number: document.amendment_number,
        effect: document.role === "amendment" ? "replace" : "add",
        category: "mandatory",
        text: sentence,
        evidence_needed: null,
        consequence: null,
        citations: [{
          document_sha256: document.document_sha256,
          chunk_id: chunk.chunkId,
          evidence_quote: sentence,
          section: null
        }]
      }));
    }
    const base = documents.find((document) => document.role === "base") ?? documents[0];
    const draft: DraftAnalysis = {
      summary: {
        title: base?.document_name.replace(/\.pdf$/i, "") ?? "Tender package",
        solicitation_number: null,
        issuer: null,
        closing_date: null,
        overview: "Local deterministic document scan. Configure Monid and OpenAI for full structured extraction.",
        scope: ["Supplied tender documents only"],
        submission_method: null,
        current_selection_method: null
      },
      claims,
      requirements,
      evaluation: {
        // The local fallback cannot independently prove evaluation semantics;
        // an arbitrary first sentence must never become a mandatory-gate rule.
        rules: []
      },
      risks: [],
      clarification_questions: ["Confirm any blank pricing fields directly with the contracting authority."],
      blocking_unknowns: ["Live model extraction was not configured; this is a deterministic local analysis."]
    };
    return {
      analysis: draft,
      latencyMs: Math.round(performance.now() - started),
      responseId: "local-deterministic",
      inputTokens: null,
      outputTokens: null
    };
  }

  async answer(): Promise<QuestionCallResult> {
    return {
      answer: {
        answerability: "not_found",
        answer: "Use the persisted evidence-only Q&A service for local runs.",
        citations: [],
        warning: "No external sources were consulted."
      },
      latencyMs: 0,
      responseId: "local-deterministic"
    };
  }
}
