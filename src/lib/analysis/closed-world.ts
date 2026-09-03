import type { AnalysisResult, Citation, QuestionResponse } from "@/contracts";
import { normalizeEvidenceText } from "@/lib/pdf/page-index";

export const CLOSED_WORLD_AUDIT = Object.freeze({
  source_scope: "document_only" as const,
  search_events: 0 as const,
  follow_embedded_link_events: 0 as const,
  document_javascript_execution_events: 0 as const,
  document_originated_tool_events: 0 as const
});

const EXTERNAL_REQUEST = /\b(?:browse|internet|web search|google|follow (?:the )?link|open (?:the )?url|latest news|outside (?:the )?documents?)\b/i;
const PROMPT_OVERRIDE = /\b(?:ignore (?:all |the )?(?:previous|system)|system prompt|developer message|call (?:a )?tool|execute (?:this )?code)\b/i;

export function sanitizeDocumentText(text: string, maximum = 500_000): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .slice(0, maximum);
}

export function isClosedWorldViolation(question: string): boolean {
  return EXTERNAL_REQUEST.test(question) || PROMPT_OVERRIDE.test(question);
}

interface AnswerUnit {
  text: string;
  citations: Citation[];
  weight: number;
}

function tokens(value: string): Set<string> {
  return new Set(
    normalizeEvidenceText(value)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3)
  );
}

function overlapScore(question: Set<string>, text: string, weight: number) {
  const candidate = tokens(text);
  let overlap = 0;
  for (const token of question) if (candidate.has(token)) overlap += 1;
  return overlap * weight;
}

export function answerFromPersistedEvidence(question: string, result: AnalysisResult): QuestionResponse {
  if (isClosedWorldViolation(question)) {
    return {
      answerability: "not_found",
      answer: "That request falls outside the supplied tender package.",
      citations: [],
      warning: "Document-only mode does not browse, follow links, execute PDF instructions, or call document-requested tools."
    };
  }

  const units: AnswerUnit[] = [
    ...result.claims
      .filter((claim) => claim.status !== "superseded")
      .map((claim) => ({ text: claim.claim_text, citations: claim.citations, weight: 1.2 })),
    ...result.requirements
      .filter((requirement) => requirement.status !== "superseded")
      .map((requirement) => ({ text: requirement.text, citations: requirement.citations, weight: 1.4 })),
    ...result.risks.map((risk) => ({
      text: `${risk.finding} ${risk.impact} ${risk.recommended_action}`,
      citations: risk.citations,
      weight: 1.1
    })),
    ...result.conflicts.map((conflict) => ({
      text: `${conflict.topic}: ${conflict.candidate_values.join(" versus ")}. ${conflict.safe_answer}`,
      citations: conflict.citations,
      weight: 1.5
    }))
  ];
  const questionTokens = tokens(question);
  const ranked = units
    .map((unit) => ({ unit, score: overlapScore(questionTokens, unit.text, unit.weight) }))
    .filter(({ score, unit }) => score > 0 && unit.citations.some((citation) => citation.verified))
    .sort((left, right) => right.score - left.score);
  if (ranked.length === 0) {
    return {
      answerability: "not_found",
      answer: "The supplied documents do not provide enough verified evidence to answer that question.",
      citations: [],
      warning: "No external sources were consulted."
    };
  }

  const best = ranked[0];
  const citations = best.unit.citations.filter((citation) => citation.verified).slice(0, 3);
  return {
    answerability: best.score >= 2.4 ? "answered" : "partial",
    answer: best.unit.text,
    citations,
    warning: best.score >= 2.4
      ? "Answered only from persisted, verified document evidence."
      : "The documents contain related evidence, but it may not fully answer the question."
  };
}
