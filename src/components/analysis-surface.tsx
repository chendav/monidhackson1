"use client";

import {
  AlertTriangle,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileCheck2,
  FileText,
  History,
  ListChecks,
  LockKeyhole,
  MessageSquareText,
  Quote,
  ReceiptText,
  Scale,
  SearchX,
  Split,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AnalysisResult,
  Citation,
  Claim,
  DocumentManifest,
  QuestionResponse,
  Requirement,
  RunStatusResponse,
} from "@/contracts";
import { useTurnstile } from "./turnstile-provider";

const ICON_SIZE = 17;
const ICON_STROKE = 1.8;

const tabs = [
  { id: "brief", label: "Executive Brief", icon: BookOpenText },
  { id: "compliance", label: "Compliance Matrix", icon: ListChecks },
  { id: "evaluation", label: "Evaluation & Pricing", icon: Scale },
  { id: "risks", label: "Risks & Conflicts", icon: AlertTriangle },
  { id: "ask", label: "Ask This RFP", icon: MessageSquareText },
  { id: "audit", label: "Audit & Cost", icon: ReceiptText },
] as const;

type TabId = (typeof tabs)[number]["id"];
type StatusValue = Claim["status"] | Requirement["status"];

interface AnalysisSurfaceProps {
  result: AnalysisResult;
  runId: string | null;
  runStatus: RunStatusResponse | null;
  isSample: boolean;
  onReset: () => void;
  onDelete: () => Promise<void>;
}

function formatUsd(microUsd: number) {
  const dollars = microUsd / 1_000_000;
  if (dollars === 0) return "$0.00";
  if (dollars < 0.01) return `$${dollars.toFixed(5)}`;
  return `$${dollars.toFixed(2)}`;
}

function formatDate(value: string | null) {
  if (!value) return "Not stated";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatusBadge({ status }: { status: StatusValue }) {
  const config = {
    active: { icon: CheckCircle2, label: "Active" },
    superseded: { icon: History, label: "Superseded" },
    conflicted: { icon: Split, label: "Conflicted" },
    needs_review: { icon: CircleHelp, label: "Needs review" },
  }[status];
  const Icon = config.icon;

  return (
    <span className={`badge badge-${status}`}>
      <Icon aria-hidden="true" size={13} strokeWidth={2} />
      {config.label}
    </span>
  );
}

function CitationDisclosure({ citation }: { citation: Citation }) {
  const pageLabel = citation.pdf_page_1based
    ? `PDF page ${citation.pdf_page_1based}`
    : "Physical page unverified";

  return (
    <details className="citation-disclosure">
      <summary>
        <span className="citation-summary-main">
          <Quote aria-hidden="true" size={14} strokeWidth={ICON_STROKE} />
          <span>{pageLabel}</span>
          <span aria-hidden="true" className="summary-separator">/</span>
          <span>{citation.document_name}</span>
        </span>
        <span className={citation.verified ? "evidence-verified" : "evidence-review"}>
          {citation.verified ? "Verified" : "Needs review"}
        </span>
        <ChevronDown className="citation-chevron" aria-hidden="true" size={14} />
      </summary>
      <div className="citation-body">
        <blockquote>{citation.evidence_quote}</blockquote>
        <dl className="citation-meta">
          <div>
            <dt>Document SHA-256</dt>
            <dd title={citation.document_sha256}>{citation.document_sha256.slice(0, 16)}...</dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd>{humanize(citation.verification_method)}</dd>
          </div>
          {citation.printed_page_label ? (
            <div>
              <dt>Printed label</dt>
              <dd>{citation.printed_page_label}</dd>
            </div>
          ) : null}
          {citation.section ? (
            <div>
              <dt>Section</dt>
              <dd>{citation.section}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </details>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) {
    return (
      <p className="missing-evidence">
        <CircleAlert aria-hidden="true" size={15} /> No verified source citation is attached.
      </p>
    );
  }
  return (
    <div className="citation-list" aria-label="Source evidence">
      {citations.map((citation, index) => (
        <CitationDisclosure
          citation={citation}
          key={`${citation.document_sha256}-${citation.pdf_page_1based ?? "unknown"}-${index}`}
        />
      ))}
    </div>
  );
}

function EmptyState({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="empty-state">
      <SearchX aria-hidden="true" size={25} strokeWidth={1.6} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function SectionHeading({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <header className="section-heading">
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </header>
  );
}

function ExecutiveBrief({ result }: { result: AnalysisResult }) {
  const activeClaims = result.claims.filter((claim) => claim.status === "active");
  const reviewClaims = result.claims.filter((claim) => claim.status !== "active");

  return (
    <div className="surface-stack">
      <SectionHeading title="Executive brief">
        A decision-oriented view of what the tender says, with source state retained beside each claim.
      </SectionHeading>

      <dl className="brief-facts">
        <div><dt>Issuer</dt><dd>{result.summary.issuer ?? "Not stated"}</dd></div>
        <div><dt>Solicitation</dt><dd>{result.summary.solicitation_number ?? "Not stated"}</dd></div>
        <div><dt>Closing date</dt><dd>{formatDate(result.summary.closing_date)}</dd></div>
        <div><dt>Selection method</dt><dd>{result.summary.current_selection_method ?? "Not stated"}</dd></div>
        <div><dt>Submission</dt><dd>{result.summary.submission_method ?? "Not stated"}</dd></div>
        <div><dt>Decision readiness</dt><dd>{humanize(result.decision_readiness)}</dd></div>
      </dl>

      <section className="content-section" aria-labelledby="overview-title">
        <h3 id="overview-title">Overview</h3>
        <p className="overview-copy">{result.summary.overview}</p>
        {result.summary.scope.length > 0 ? (
          <ul className="scope-list" aria-label="Scope">
            {result.summary.scope.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : null}
      </section>

      <section className="content-section" aria-labelledby="active-claims-title">
        <div className="content-title-row">
          <h3 id="active-claims-title">Current decision facts</h3>
          <span>{activeClaims.length} active</span>
        </div>
        {activeClaims.length ? (
          <div className="claim-list">
            {activeClaims.map((claim) => <ClaimRow claim={claim} key={claim.claim_id} />)}
          </div>
        ) : (
          <EmptyState title="No active claims">The analysis did not return a supported current claim.</EmptyState>
        )}
      </section>

      {reviewClaims.length ? (
        <section className="content-section review-section" aria-labelledby="review-claims-title">
          <div className="content-title-row">
            <h3 id="review-claims-title">Superseded, conflicted, or review-needed</h3>
            <span>{reviewClaims.length} retained for audit</span>
          </div>
          <div className="claim-list">
            {reviewClaims.map((claim) => <ClaimRow claim={claim} key={claim.claim_id} />)}
          </div>
        </section>
      ) : null}

      {result.blocking_unknowns.length ? (
        <section className="unknowns-callout" aria-labelledby="unknowns-title">
          <CircleHelp aria-hidden="true" size={20} />
          <div>
            <h3 id="unknowns-title">Blocking unknowns</h3>
            <ul>{result.blocking_unknowns.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <article className="claim-row">
      <div className="claim-main">
        <div className="claim-labels">
          <StatusBadge status={claim.status} />
          <span className="claim-type">{humanize(claim.claim_type)}</span>
          <span className="confidence">{Math.round(claim.confidence * 100)}% confidence</span>
        </div>
        <p>{claim.claim_text}</p>
        {claim.formula_and_inputs ? (
          <details className="formula-disclosure">
            <summary>Show derivation</summary>
            <code>{claim.formula_and_inputs.formula}</code>
          </details>
        ) : null}
      </div>
      <CitationList citations={claim.citations} />
    </article>
  );
}

function ComplianceMatrix({ requirements }: { requirements: Requirement[] }) {
  const counts = useMemo(() => ({
    active: requirements.filter((item) => item.status === "active").length,
    superseded: requirements.filter((item) => item.status === "superseded").length,
    conflicted: requirements.filter((item) => item.status === "conflicted").length,
    needs_review: requirements.filter((item) => item.status === "needs_review").length,
  }), [requirements]);

  return (
    <div className="surface-stack">
      <SectionHeading title="Compliance matrix">
        Requirements stay tied to their lifecycle state. Superseded text remains visible but is never presented as current.
      </SectionHeading>
      <div className="status-summary" aria-label="Requirement status counts">
        {(Object.keys(counts) as StatusValue[]).map((status) => (
          <div key={status}>
            <StatusBadge status={status} />
            <strong>{counts[status]}</strong>
          </div>
        ))}
      </div>
      {requirements.length ? (
        <div className="table-scroll" tabIndex={0} aria-label="Scrollable compliance matrix">
          <table className="data-table compliance-table">
            <caption className="sr-only">Tender compliance requirements and source evidence</caption>
            <thead>
              <tr><th>Requirement</th><th>Category</th><th>Status</th><th>Evidence needed</th><th>Consequence</th><th>Source</th></tr>
            </thead>
            <tbody>
              {requirements.map((item) => (
                <tr key={item.id}>
                  <th scope="row">{item.text}</th>
                  <td>{humanize(item.category)}</td>
                  <td><StatusBadge status={item.status} /></td>
                  <td>{item.evidence_needed ?? "Not stated"}</td>
                  <td>{item.consequence ?? "Not stated"}</td>
                  <td className="source-cell"><CitationList citations={item.citations} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No requirements extracted">No supported requirements were returned for this package.</EmptyState>
      )}
    </div>
  );
}

function EvaluationPricing({ result }: { result: AnalysisResult }) {
  const financialRequirements = result.requirements.filter((item) => item.category === "financial");
  const evaluation = result.evaluation;
  const metrics = [
    ["Mandatory gate", evaluation.mandatory_gate === null ? "Not stated" : evaluation.mandatory_gate ? "Yes" : "No"],
    ["Rated threshold", evaluation.rated_threshold ?? "Not stated"],
    ["Technical weight", evaluation.technical_weight === null ? "Not stated" : `${evaluation.technical_weight}%`],
    ["Financial weight", evaluation.financial_weight === null ? "Not stated" : `${evaluation.financial_weight}%`],
    ["Selection method", evaluation.selection_method ?? "Not stated"],
  ] as const;

  return (
    <div className="surface-stack">
      <SectionHeading title="Evaluation and pricing">
        Scoring rules and price inputs are shown exactly as supported. Blank pricing fields remain unknown, never zero.
      </SectionHeading>
      <dl className="evaluation-grid">
        {metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <section className="content-section" aria-labelledby="evaluation-evidence-title">
        <h3 id="evaluation-evidence-title">Evaluation evidence</h3>
        <CitationList citations={evaluation.citations} />
      </section>
      <section className="content-section" aria-labelledby="financial-inputs-title">
        <div className="content-title-row">
          <h3 id="financial-inputs-title">Financial inputs</h3>
          <span>Document values only</span>
        </div>
        {financialRequirements.length ? (
          <div className="claim-list">
            {financialRequirements.map((item) => (
              <article className="claim-row" key={item.id}>
                <div className="claim-main">
                  <div className="claim-labels"><StatusBadge status={item.status} /></div>
                  <p>{item.text}</p>
                  <span className="muted-copy">{item.evidence_needed ?? "Required pricing evidence is not stated."}</span>
                </div>
                <CitationList citations={item.citations} />
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Pricing is unknown">
            No supported price value was found. The workspace does not convert empty placeholders to zero.
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function RisksConflicts({ result }: { result: AnalysisResult }) {
  return (
    <div className="surface-stack">
      <SectionHeading title="Risks and conflicts">
        Findings are source-backed. Conflicting amendment values remain unresolved until the issuer clarifies them.
      </SectionHeading>
      <section className="content-section" aria-labelledby="risks-title">
        <div className="content-title-row"><h3 id="risks-title">Risks</h3><span>{result.risks.length} findings</span></div>
        {result.risks.length ? (
          <div className="risk-list">
            {result.risks.map((risk) => (
              <article className={`risk-item severity-${risk.severity}`} key={risk.id}>
                <div className="risk-heading">
                  <span className="severity-label">{humanize(risk.severity)} risk</span>
                  <span>{risk.category}</span>
                </div>
                <h4>{risk.finding}</h4>
                <dl><div><dt>Impact</dt><dd>{risk.impact}</dd></div><div><dt>Recommended action</dt><dd>{risk.recommended_action}</dd></div></dl>
                <CitationList citations={risk.citations} />
              </article>
            ))}
          </div>
        ) : <EmptyState title="No supported risks">The analysis did not return a source-backed risk.</EmptyState>}
      </section>
      <section className="content-section" aria-labelledby="conflicts-title">
        <div className="content-title-row"><h3 id="conflicts-title">Unresolved conflicts</h3><span>{result.conflicts.length} conflicts</span></div>
        {result.conflicts.length ? (
          <div className="conflict-list">
            {result.conflicts.map((conflict) => (
              <article className="conflict-item" key={conflict.id}>
                <div className="claim-labels"><StatusBadge status="conflicted" /></div>
                <h4>{conflict.topic}</h4>
                <div className="candidate-values">
                  {conflict.candidate_values.map((value, index) => (
                    <div key={`${value}-${index}`}><span>Candidate {index + 1}</span><strong>{value}</strong></div>
                  ))}
                </div>
                <p className="safe-answer"><strong>Safe answer:</strong> {conflict.safe_answer}</p>
                <CitationList citations={conflict.citations} />
              </article>
            ))}
          </div>
        ) : <EmptyState title="No amendment conflicts">No unresolved conflict was returned for this package.</EmptyState>}
      </section>
    </div>
  );
}

async function readErrorMessage(response: Response) {
  try {
    const payload = await response.json() as { error?: { message?: string } };
    return payload.error?.message ?? `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

function AskRfp({ runId, isSample }: { runId: string | null; isSample: boolean }) {
  const { getMutationHeaders } = useTurnstile();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<QuestionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!runId || !trimmed || isAsking) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsAsking(true);
    setError(null);
    setAnswer(null);
    try {
      const headers = await getMutationHeaders(
        "ask_question",
        controller.signal,
        { "content-type": "application/json" },
      );
      const response = await fetch(`/api/v1/runs/${runId}/questions`, {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ question: trimmed }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      setAnswer(await response.json() as QuestionResponse);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "The question could not be answered.");
    } finally {
      if (!controller.signal.aborted) setIsAsking(false);
    }
  }

  return (
    <div className="surface-stack">
      <SectionHeading title="Ask this RFP">
        Answers use this tender pack only. The system does not search the web or follow links found inside the PDFs.
      </SectionHeading>
      <div className="closed-world-note"><LockKeyhole aria-hidden="true" size={18} /><span><strong>Closed-world answer.</strong> Missing evidence is reported as not found.</span></div>
      {isSample || !runId ? (
        <EmptyState title="Questions need a live run">
          The Edmonton sample demonstrates analysis output. Analyze your own pack to ask grounded questions.
        </EmptyState>
      ) : (
        <>
          <form className="question-form" onSubmit={submitQuestion}>
            <label htmlFor="rfp-question">Question</label>
            <textarea
              id="rfp-question"
              maxLength={1000}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Which forms must be submitted with the bid?"
              rows={4}
              value={question}
            />
            <div className="question-actions"><span>{question.length} / 1000</span><button className="primary-button" disabled={!question.trim() || isAsking} type="submit">{isAsking ? "Checking the pack..." : "Ask this RFP"}</button></div>
          </form>
          {error ? <div className="inline-alert error-alert" role="alert"><CircleAlert aria-hidden="true" size={18} /><p>{error}</p></div> : null}
          {isAsking ? <div className="answer-skeleton" aria-label="Checking the tender pack" role="status"><span /><span /><span /></div> : null}
          {answer ? (
            <article className="answer-card" aria-live="polite">
              <div className="answer-status"><span className={`answerability answer-${answer.answerability}`}>{humanize(answer.answerability)}</span><span>Document-only response</span></div>
              <p>{answer.answer}</p>
              {answer.warning ? <div className="inline-alert warning-alert"><TriangleAlert aria-hidden="true" size={17} /><p>{answer.warning}</p></div> : null}
              <CitationList citations={answer.citations} />
            </article>
          ) : null}
        </>
      )}
    </div>
  );
}

function DocumentStatus({ document }: { document: DocumentManifest }) {
  return (
    <div className="document-statuses">
      <span className={`badge badge-${document.status}`}>{document.status === "active" ? <CheckCircle2 aria-hidden="true" size={13} /> : <History aria-hidden="true" size={13} />}{humanize(document.status)}</span>
      <span className={`cleanup-badge cleanup-${document.cleanup_status}`}>
        {document.cleanup_status === "deleted" ? <Check aria-hidden="true" size={13} /> : document.cleanup_status === "failed" ? <CircleAlert aria-hidden="true" size={13} /> : <Clock3 aria-hidden="true" size={13} />}
        Source {humanize(document.cleanup_status)}
      </span>
    </div>
  );
}

function AuditCost({ result, runStatus }: { result: AnalysisResult; runStatus: RunStatusResponse | null }) {
  const quality = result.quality;
  const cleanupConfirmed = runStatus?.cleanup_confirmed ?? result.document_manifest.every((document) => document.cleanup_status === "deleted");

  return (
    <div className="surface-stack">
      <SectionHeading title="Audit and cost">
        Processing scope, deletion evidence, source provenance, and measured run cost are kept together.
      </SectionHeading>
      <section className="boundary-panel" aria-labelledby="source-boundary-title">
        <div className="boundary-icon"><LockKeyhole aria-hidden="true" size={22} /></div>
        <div>
          <h3 id="source-boundary-title">Document-only boundary</h3>
          <p>The analysis used the supplied PDFs only. Search events: <strong>{quality.search_events}</strong>. Embedded-link follows: <strong>{quality.follow_embedded_link_events}</strong>.</p>
        </div>
        <span className="boundary-state"><CheckCircle2 aria-hidden="true" size={15} /> No search</span>
      </section>
      <section className="retention-panel" aria-labelledby="retention-title">
        <TriangleAlert aria-hidden="true" size={20} />
        <div>
          <h3 id="retention-title">Provider retention disclosure</h3>
          <p>App-controlled source files and temporary parse artifacts must be deleted before a run is ready. Early deletion and zero-data-retention for upstream processing providers have not been verified. Structured, redacted output expires after 24 hours.</p>
          <strong className={cleanupConfirmed ? "cleanup-confirmed" : "cleanup-unconfirmed"}>{cleanupConfirmed ? "App-controlled cleanup confirmed" : "App-controlled cleanup is not confirmed"}</strong>
        </div>
      </section>
      <div className="audit-grid">
        <section className="content-section" aria-labelledby="quality-title">
          <h3 id="quality-title">Coverage and verification</h3>
          <dl className="quality-list">
            <div><dt>Physical pages covered</dt><dd>{quality.pages_covered} / {quality.pages_total}</dd></div>
            <div><dt>Critical claims cited</dt><dd>{quality.critical_claims_cited} / {quality.critical_claims}</dd></div>
            <div><dt>Verified citations</dt><dd>{quality.citations_verified}</dd></div>
            <div><dt>Unsupported items removed</dt><dd>{quality.unsupported_items_removed}</dd></div>
            <div><dt>Package completeness</dt><dd>{humanize(result.package_completeness)}</dd></div>
          </dl>
          {quality.warnings.length ? <div className="warning-list"><strong>Warnings</strong><ul>{quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
        </section>
        <section className="content-section" aria-labelledby="cost-title">
          <h3 id="cost-title">Run cost</h3>
          <dl className="cost-totals">
            <div><dt>Actual</dt><dd>{formatUsd(result.costs.actual_micro_usd)}</dd></div>
            <div><dt>Estimated</dt><dd>{formatUsd(result.costs.estimated_micro_usd)}</dd></div>
            <div><dt>Combined ledger</dt><dd>{formatUsd(result.costs.total_micro_usd)}</dd></div>
          </dl>
          <p className="cost-note">USD. {result.costs.includes_failed_attempts ? "Failed attempts are included." : "Failed attempts are not included."}</p>
        </section>
      </div>
      <section className="content-section" aria-labelledby="manifest-title">
        <div className="content-title-row"><h3 id="manifest-title">Document manifest</h3><span>{result.document_manifest.length} source files</span></div>
        <div className="manifest-list">
          {result.document_manifest.map((document) => (
            <article className="manifest-item" key={document.document_id}>
              <FileText aria-hidden="true" size={20} />
              <div className="manifest-copy"><h4>{document.source_name}</h4><p>{humanize(document.role)} / {document.pages} pages / SHA {document.sha256.slice(0, 12)}...</p></div>
              <DocumentStatus document={document} />
            </article>
          ))}
        </div>
      </section>
      <section className="content-section" aria-labelledby="ledger-title">
        <div className="content-title-row"><h3 id="ledger-title">Provider cost ledger</h3><span>{result.costs.events.length} events</span></div>
        {result.costs.events.length ? (
          <div className="table-scroll" tabIndex={0} aria-label="Scrollable provider cost ledger">
            <table className="data-table cost-table">
              <caption className="sr-only">Actual and estimated provider costs</caption>
              <thead><tr><th>Provider</th><th>Operation</th><th>Status</th><th>Actual</th><th>Estimated</th><th>Latency</th></tr></thead>
              <tbody>{result.costs.events.map((event, index) => (
                <tr key={`${event.provider}-${event.operation}-${index}`}>
                  <th scope="row">{humanize(event.provider)}</th><td>{event.operation}</td><td>{humanize(event.status)}</td>
                  <td>{event.actual_micro_usd === null ? <span className="not-reported">Not reported</span> : <><span className="cost-kind">Actual</span>{formatUsd(event.actual_micro_usd)}</>}</td>
                  <td>{event.estimated_micro_usd === null ? <span className="not-reported">Not estimated</span> : <><span className="cost-kind">Estimated</span>{formatUsd(event.estimated_micro_usd)}</>}</td>
                  <td>{event.latency_ms.toLocaleString("en-CA")} ms</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No provider events">The run returned no cost events.</EmptyState>}
      </section>
    </div>
  );
}

export function AnalysisSurface({ result, runId, runStatus, isSample, onReset, onDelete }: AnalysisSurfaceProps) {
  const [activeTab, setActiveTab] = useState<TabId>("brief");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());

  useEffect(() => {
    titleRef.current?.focus();
  }, [result]);

  function selectTab(tab: TabId) {
    setActiveTab(tab);
    requestAnimationFrame(() => document.getElementById(`panel-${tab}`)?.focus());
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex].id;
    setActiveTab(next);
    tabRefs.current.get(next)?.focus();
  }

  async function requestDelete() {
    if (isSample) {
      onReset();
      return;
    }
    if (!window.confirm("Delete this analysis and its retained structured output now?")) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "The analysis could not be deleted.");
      setIsDeleting(false);
    }
  }

  const readyLabel = isSample ? "Verified sample" : runStatus?.status === "partial" ? "Partial result" : "Analysis ready";

  return (
    <article className="analysis-shell" aria-labelledby="analysis-title">
      <header className="analysis-header">
        <div className="analysis-heading-copy">
          <div className="result-state"><FileCheck2 aria-hidden="true" size={16} /><span>{readyLabel}</span><span aria-hidden="true">/</span><span>Document-only</span></div>
          <h1 id="analysis-title" ref={titleRef} tabIndex={-1}>{result.summary.title || "Tender analysis"}</h1>
          <p>Generated {formatDate(result.generated_at)}. Expires {formatDate(result.expires_at)}.</p>
        </div>
        <div className="analysis-actions">
          <a className="secondary-button" href="/api/openapi.json" target="_blank" rel="noreferrer">API schema <ExternalLink aria-hidden="true" size={14} /></a>
          <button className="danger-button" disabled={isDeleting} onClick={requestDelete} type="button"><Trash2 aria-hidden="true" size={15} />{isSample ? "Close sample" : isDeleting ? "Deleting..." : "Delete analysis"}</button>
        </div>
      </header>
      {deleteError ? <div className="inline-alert error-alert result-delete-error" role="alert"><CircleAlert aria-hidden="true" size={18} /><p>{deleteError}</p></div> : null}

      <nav className="result-tabs" aria-label="Analysis views" role="tablist">
        {tabs.map((tab, index) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              aria-controls={`panel-${tab.id}`}
              aria-selected={selected}
              id={`tab-${tab.id}`}
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              ref={(element) => { if (element) tabRefs.current.set(tab.id, element); else tabRefs.current.delete(tab.id); }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" size={ICON_SIZE} strokeWidth={ICON_STROKE} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="result-panel" id="panel-brief" aria-labelledby="tab-brief" hidden={activeTab !== "brief"} role="tabpanel" tabIndex={0}>
        <ExecutiveBrief result={result} />
      </div>
      <div className="result-panel" id="panel-compliance" aria-labelledby="tab-compliance" hidden={activeTab !== "compliance"} role="tabpanel" tabIndex={0}>
        <ComplianceMatrix requirements={result.requirements} />
      </div>
      <div className="result-panel" id="panel-evaluation" aria-labelledby="tab-evaluation" hidden={activeTab !== "evaluation"} role="tabpanel" tabIndex={0}>
        <EvaluationPricing result={result} />
      </div>
      <div className="result-panel" id="panel-risks" aria-labelledby="tab-risks" hidden={activeTab !== "risks"} role="tabpanel" tabIndex={0}>
        <RisksConflicts result={result} />
      </div>
      <div className="result-panel" id="panel-ask" aria-labelledby="tab-ask" hidden={activeTab !== "ask"} role="tabpanel" tabIndex={0}>
        <AskRfp isSample={isSample} runId={runId} />
      </div>
      <div className="result-panel" id="panel-audit" aria-labelledby="tab-audit" hidden={activeTab !== "audit"} role="tabpanel" tabIndex={0}>
        <AuditCost result={result} runStatus={runStatus} />
      </div>
    </article>
  );
}
