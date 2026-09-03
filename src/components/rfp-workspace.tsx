"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileSearch2,
  FileText,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RotateCcw,
  ScanText,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AnalysisResult,
  ApiError,
  CreateRunRequest,
  CreateRunResponse,
  PresignUploadResponse,
  RunStatus,
  RunStatusResponse,
} from "@/contracts";
import { AnalysisSurface } from "./analysis-surface";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const POLL_INTERVAL_MS = 900;
const ICON_STROKE = 1.8;

type SourceMode = "url" | "upload";
type DocumentRole = "base" | "amendment";
type Phase = "idle" | "starting" | "polling" | "result" | "error";

interface UrlDraft {
  id: string;
  role: DocumentRole;
  url: string;
}

interface FileDraft {
  id: string;
  role: DocumentRole;
  file: File;
}

interface UiError {
  code: string;
  message: string;
  retryable: boolean;
  requestId?: string;
}

interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => unknown | Promise<unknown>;
}

interface ModelContext {
  registerTool: (
    tool: ModelContextTool,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

const orderedStages: RunStatus[] = [
  "queued",
  "validating",
  "staging",
  "page_indexing",
  "parsing",
  "purging_source",
  "extracting",
  "reconciling",
  "verifying",
];

const stageCopy: Record<RunStatus, { label: string; detail: string }> = {
  queued: { label: "Queued", detail: "The run has a reserved place in the processing queue." },
  validating: { label: "Validating sources", detail: "Checking host, format, size, count, and package limits." },
  staging: { label: "Staging private files", detail: "Making the source pack available to the controlled parser." },
  page_indexing: { label: "Indexing physical pages", detail: "Binding text fragments to PDF pages and source hashes." },
  parsing: { label: "Parsing documents", detail: "Normalizing the supplied PDFs without following links or instructions." },
  purging_source: { label: "Confirming source cleanup", detail: "Deleting app-controlled source and temporary artifacts." },
  extracting: { label: "Extracting requirements", detail: "Finding supported obligations, evaluation rules, dates, and blanks." },
  reconciling: { label: "Reconciling amendments", detail: "Separating active, superseded, and conflicting statements." },
  verifying: { label: "Verifying evidence", detail: "Checking quotes and physical-page citations before release." },
  ready: { label: "Analysis ready", detail: "The result and cleanup confirmations are available." },
  partial: { label: "Partial analysis available", detail: "Supported results are available with limitations shown." },
  failed: { label: "Analysis failed", detail: "The run stopped before a result could be released." },
  cleanup_pending: { label: "Cleanup pending", detail: "The result stays locked until source deletion is confirmed." },
  expired: { label: "Analysis expired", detail: "The retained structured result is no longer available." },
};

function newId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isCanadaBuysUrl(rawValue: string) {
  try {
    const url = new URL(rawValue);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "canadabuys.canada.ca";
  } catch {
    return false;
  }
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveStatusUrl(runId: string, reportedStatusUrl: string) {
  const canonicalStatusUrl = `/api/v1/runs/${encodeURIComponent(runId)}`;
  return reportedStatusUrl === canonicalStatusUrl ? reportedStatusUrl : canonicalStatusUrl;
}

async function parseApiError(response: Response): Promise<UiError> {
  try {
    const payload = await response.json() as Partial<ApiError>;
    if (payload.error) {
      return {
        code: payload.error.code,
        message: payload.error.message,
        retryable: payload.error.retryable,
        requestId: payload.error.request_id,
      };
    }
  } catch {
    // The status fallback below is intentionally used for non-JSON failures.
  }
  return {
    code: `HTTP_${response.status}`,
    message: `The request failed with status ${response.status}.`,
    retryable: response.status >= 500 || response.status === 429,
  };
}

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function SourceRoleSelect({
  id,
  role,
  onChange,
}: {
  id: string;
  role: DocumentRole;
  onChange: (role: DocumentRole) => void;
}) {
  return (
    <div className="role-field">
      <label htmlFor={id}>Document role</label>
      <select id={id} onChange={(event) => onChange(event.target.value as DocumentRole)} value={role}>
        <option value="base">Base RFP</option>
        <option value="amendment">Amendment</option>
      </select>
    </div>
  );
}

function SourceBuilder({
  mode,
  setMode,
  urlDrafts,
  setUrlDrafts,
  fileDrafts,
  setFileDrafts,
  onLoadSample,
  onSubmit,
  validationError,
}: {
  mode: SourceMode;
  setMode: (mode: SourceMode) => void;
  urlDrafts: UrlDraft[];
  setUrlDrafts: (updater: (current: UrlDraft[]) => UrlDraft[]) => void;
  fileDrafts: FileDraft[];
  setFileDrafts: (updater: (current: FileDraft[]) => FileDraft[]) => void;
  onLoadSample: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  validationError: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextUrlIndex = urlDrafts.length + 1;

  function setUrlRole(id: string, role: DocumentRole) {
    setUrlDrafts((current) => current.map((draft) => {
      if (draft.id === id) return { ...draft, role };
      if (role === "base" && draft.role === "base") return { ...draft, role: "amendment" };
      return draft;
    }));
  }

  function removeUrl(id: string) {
    setUrlDrafts((current) => {
      const filtered = current.filter((draft) => draft.id !== id);
      if (!filtered.some((draft) => draft.role === "base") && filtered[0]) {
        filtered[0] = { ...filtered[0], role: "base" };
      }
      return filtered;
    });
  }

  function setFileRole(id: string, role: DocumentRole) {
    setFileDrafts((current) => current.map((draft) => {
      if (draft.id === id) return { ...draft, role };
      if (role === "base" && draft.role === "base") return { ...draft, role: "amendment" };
      return draft;
    }));
  }

  function removeFile(id: string) {
    setFileDrafts((current) => {
      const filtered = current.filter((draft) => draft.id !== id);
      if (!filtered.some((draft) => draft.role === "base") && filtered[0]) {
        filtered[0] = { ...filtered[0], role: "base" };
      }
      return filtered;
    });
  }

  function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    setFileDrafts((current) => {
      const available = Math.max(0, MAX_FILES - current.length);
      const seen = new Set(current.map((draft) => `${draft.file.name}:${draft.file.size}:${draft.file.lastModified}`));
      const additions = incoming
        .filter((file) => {
          const key = `${file.name}:${file.size}:${file.lastModified}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, available)
        .map((file, index) => ({
          id: newId("file"),
          role: current.length === 0 && index === 0 ? "base" as const : "amendment" as const,
          file,
        }));
      return [...current, ...additions];
    });
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  const documentCount = mode === "url" ? urlDrafts.length : fileDrafts.length;

  return (
    <section className="source-builder" aria-labelledby="source-builder-title">
      <header className="builder-heading">
        <p className="eyebrow">Procurement analysis workspace</p>
        <h1 id="source-builder-title">Analyze a tender pack</h1>
        <p>Build a source-linked brief from one base RFP and up to four amendments.</p>
      </header>

      <button className="mobile-sample-shortcut" onClick={onLoadSample} type="button"><FileCheck2 aria-hidden="true" size={16} />Preview Edmonton sample<ArrowRight aria-hidden="true" size={15} /></button>

      <form className="source-form" onSubmit={onSubmit} noValidate>
        <fieldset className="source-mode-picker">
          <legend>Choose a source method</legend>
          <div className="segmented-control">
            <button aria-pressed={mode === "url"} onClick={() => setMode("url")} type="button"><Link2 aria-hidden="true" size={17} />CanadaBuys URL</button>
            <button aria-pressed={mode === "upload"} onClick={() => setMode("upload")} type="button"><UploadCloud aria-hidden="true" size={17} />PDF pack</button>
          </div>
        </fieldset>

        {mode === "url" ? (
          <div className="source-documents" data-testid="url-source-panel">
            {urlDrafts.map((draft, index) => (
              <article className="document-input" key={draft.id}>
                <div className="document-input-heading"><FileText aria-hidden="true" size={18} /><strong>{draft.role === "base" ? "Base document" : `Amendment ${index}`}</strong>{urlDrafts.length > 1 ? <button aria-label={`Remove ${draft.role === "base" ? "base document" : `amendment ${index}`}`} className="icon-button" onClick={() => removeUrl(draft.id)} type="button"><X aria-hidden="true" size={17} /></button> : null}</div>
                <div className="document-input-grid">
                  <div className="url-field">
                    <label htmlFor={`url-${draft.id}`}>CanadaBuys PDF URL</label>
                    <input
                      autoComplete="url"
                      id={`url-${draft.id}`}
                      onChange={(event) => setUrlDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, url: event.target.value } : item))}
                      placeholder="https://canadabuys.canada.ca/..."
                      type="url"
                      value={draft.url}
                    />
                  </div>
                  <SourceRoleSelect id={`url-role-${draft.id}`} onChange={(role) => setUrlRole(draft.id, role)} role={draft.role} />
                </div>
              </article>
            ))}
            <button className="add-source-button" disabled={urlDrafts.length >= MAX_FILES} onClick={() => setUrlDrafts((current) => [...current, { id: newId("url"), role: "amendment", url: "" }])} type="button"><Plus aria-hidden="true" size={16} />Add amendment URL <span>{nextUrlIndex} / {MAX_FILES}</span></button>
            <p className="field-help">HTTPS links on canadabuys.canada.ca only. Links found inside a PDF are never followed.</p>
          </div>
        ) : (
          <div className="source-documents" data-testid="upload-source-panel">
            <div
              className={`dropzone ${dragging ? "is-dragging" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <input accept="application/pdf,.pdf" id="pdf-pack" multiple onChange={handleFiles} ref={fileInputRef} type="file" />
              <UploadCloud aria-hidden="true" size={24} />
              <div><strong>Drop PDF files here</strong><span>or choose files from this device</span></div>
              <button className="secondary-button" onClick={() => fileInputRef.current?.click()} type="button">Choose PDFs</button>
            </div>
            <p className="field-help">Up to five PDFs, 25 MB each, and 300 pages total. The server verifies the aggregate page limit.</p>
            {fileDrafts.length ? (
              <div className="file-list" aria-label="Selected PDF files">
                {fileDrafts.map((draft) => (
                  <article className="file-item" key={draft.id}>
                    <FileText aria-hidden="true" size={19} />
                    <div className="file-copy"><strong>{draft.file.name}</strong><span>{(draft.file.size / 1024 / 1024).toFixed(2)} MB</span></div>
                    <SourceRoleSelect id={`file-role-${draft.id}`} onChange={(role) => setFileRole(draft.id, role)} role={draft.role} />
                    <button aria-label={`Remove ${draft.file.name}`} className="icon-button" onClick={() => removeFile(draft.id)} type="button"><Trash2 aria-hidden="true" size={16} /></button>
                    {draft.file.size > MAX_FILE_BYTES || (!draft.file.name.toLowerCase().endsWith(".pdf") && draft.file.type !== "application/pdf") ? (
                      <p className="file-error"><CircleAlert aria-hidden="true" size={14} />{draft.file.size > MAX_FILE_BYTES ? "File exceeds 25 MB." : "File must be a PDF."}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {validationError ? <div className="inline-alert error-alert form-error" role="alert"><CircleAlert aria-hidden="true" size={18} /><p>{validationError}</p></div> : null}

        <div className="ingest-footer">
          <div className="privacy-note"><ShieldCheck aria-hidden="true" size={18} /><span>Private transfer. App-controlled source files are deleted before results are released.</span></div>
          <button className="primary-button analyze-button" disabled={documentCount === 0} type="submit"><FileSearch2 aria-hidden="true" size={18} />Analyze {documentCount > 1 ? `${documentCount} documents` : "pack"}<ArrowRight aria-hidden="true" size={17} /></button>
        </div>
      </form>
    </section>
  );
}

function SamplePanel({ onLoadSample, loading }: { onLoadSample: () => void; loading: boolean }) {
  return (
    <aside className="sample-panel" aria-labelledby="sample-title">
      <header className="sample-header">
        <div><p className="sample-label">Edmonton verified sample</p><h2 id="sample-title">Repair &amp; Maintenance on various File Bays</h2></div>
        <span className="sample-state"><FileCheck2 aria-hidden="true" size={14} />Golden fixture</span>
      </header>
      <p className="sample-description">See the full workspace with a real 55-page procurement package before uploading your own.</p>
      <dl className="sample-metrics">
        <div><dt>Physical pages</dt><dd>55</dd></div>
        <div><dt>Award method</dt><dd>Lowest evaluated price</dd></div>
        <div><dt>Search events</dt><dd>0</dd></div>
      </dl>
      <section className="sample-finding" aria-labelledby="sample-finding-title">
        <div className="finding-label"><AlertTriangle aria-hidden="true" size={15} /><span>High risk</span></div>
        <h3 id="sample-finding-title">Security annex conflict</h3>
        <p>One clause calls the checklist Annex D while the package identifies it as Annex E.</p>
        <span className="evidence-preview">Verified evidence on PDF page 17</span>
      </section>
      <div className="sample-audit-row"><span><CheckCircle2 aria-hidden="true" size={15} />Source cleanup confirmed</span><span><LockKeyhole aria-hidden="true" size={15} />Document-only</span></div>
      <button className="sample-button" disabled={loading} onClick={onLoadSample} type="button">{loading ? <><LoaderCircle className="spin" aria-hidden="true" size={17} />Loading sample...</> : <>Open Edmonton sample<ArrowRight aria-hidden="true" size={17} /></>}</button>
    </aside>
  );
}

function ProgressSurface({
  localMessage,
  localProgress,
  onStop,
  status,
}: {
  localMessage: string;
  localProgress: number;
  onStop: () => void;
  status: RunStatusResponse | null;
}) {
  const currentStatus = status?.status ?? "queued";
  const displayStage = status?.stage ?? currentStatus;
  const copy = currentStatus === "cleanup_pending" ? stageCopy.cleanup_pending : stageCopy[displayStage];
  const progress = status?.progress ?? localProgress;
  const currentIndex = orderedStages.indexOf(displayStage);
  const cleanupPending = currentStatus === "cleanup_pending";

  return (
    <main className="progress-page" id="main-content">
      <section className={`progress-surface ${cleanupPending ? "cleanup-wait" : ""}`} aria-labelledby="progress-title" role="status" aria-live="polite">
        <div className="progress-icon">{cleanupPending ? <Clock3 aria-hidden="true" size={25} /> : <ScanText aria-hidden="true" size={25} />}</div>
        <p className="eyebrow">{cleanupPending ? "Fail-closed cleanup gate" : "Analysis in progress"}</p>
        <h1 id="progress-title">{status ? copy.label : localMessage}</h1>
        <p>{status ? copy.detail : "Keep this page open. The run continues if you stop watching."}</p>
        {cleanupPending ? <div className="cleanup-warning"><AlertTriangle aria-hidden="true" size={18} /><span>No result is shown until every app-controlled source deletion has a confirmation receipt.</span></div> : null}
        <div className="progress-meter"><div className="progress-label"><span>{status ? humanize(displayStage) : "Preparing"}</span><strong>{progress}%</strong></div><progress max="100" value={progress}>{progress}%</progress></div>
        <ol className="stage-list" aria-label="Analysis stages">
          {orderedStages.map((stage, index) => {
            const isCurrent = cleanupPending ? stage === "purging_source" : stage === displayStage;
            const isComplete = !cleanupPending && currentIndex > index;
            return <li className={isCurrent ? "stage-current" : isComplete ? "stage-complete" : ""} key={stage}>{isComplete ? <Check aria-hidden="true" size={14} /> : <span aria-hidden="true">{index + 1}</span>}<span>{stageCopy[stage].label}</span></li>;
          })}
        </ol>
        <div className="result-skeleton" aria-hidden="true"><span /><span /><span /><span /></div>
        <button className="secondary-button stop-button" onClick={onStop} type="button">Stop watching</button>
      </section>
    </main>
  );
}

function ErrorSurface({ error, onBack, onRetry }: { error: UiError; onBack: () => void; onRetry: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <main className="error-page" id="main-content">
      <section className="error-surface" aria-labelledby="error-title">
        <div className="error-icon"><CircleAlert aria-hidden="true" size={25} /></div>
        <p className="eyebrow">{error.code}</p>
        <h1 id="error-title" ref={headingRef} tabIndex={-1}>The pack could not be analyzed</h1>
        <p>{error.message}</p>
        {error.requestId ? <p className="request-id">Request ID: <code>{error.requestId}</code></p> : null}
        <div className="error-actions">{error.retryable ? <button className="primary-button" onClick={onRetry} type="button"><RotateCcw aria-hidden="true" size={16} />Try again</button> : null}<button className="secondary-button" onClick={onBack} type="button">Review sources</button></div>
      </section>
    </main>
  );
}

export function RfpWorkspace() {
  const [mode, setMode] = useState<SourceMode>("url");
  const [urlDrafts, setUrlDraftsState] = useState<UrlDraft[]>([{ id: "url-base", role: "base", url: "" }]);
  const [fileDrafts, setFileDraftsState] = useState<FileDraft[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [statusUrl, setStatusUrl] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatusResponse | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [uiError, setUiError] = useState<UiError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState("Preparing your tender pack");
  const [localProgress, setLocalProgress] = useState(4);
  const [pollRevision, setPollRevision] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const lastActionRef = useRef<"sample" | "analysis">("analysis");

  const setUrlDrafts = useCallback((updater: (current: UrlDraft[]) => UrlDraft[]) => setUrlDraftsState(updater), []);
  const setFileDrafts = useCallback((updater: (current: FileDraft[]) => FileDraft[]) => setFileDraftsState(updater), []);

  const resetToInputs = useCallback(() => {
    requestRef.current?.abort();
    setPhase("idle");
    setRunId(null);
    setStatusUrl(null);
    setRunStatus(null);
    setResult(null);
    setIsSample(false);
    setUiError(null);
    setValidationError(null);
    setLocalProgress(4);
    idempotencyKeyRef.current = null;
  }, []);

  const showError = useCallback((error: UiError) => {
    setUiError(error);
    setPhase("error");
  }, []);

  const loadSample = useCallback(async (externalSignal?: AbortSignal) => {
    lastActionRef.current = "sample";
    idempotencyKeyRef.current = null;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener("abort", () => controller.abort(externalSignal.reason), { once: true });
    }
    setPhase("starting");
    setLocalMessage("Loading the verified Edmonton sample");
    setLocalProgress(32);
    setUiError(null);
    setValidationError(null);
    try {
      const response = await fetch("/api/v1/samples/edmonton", { credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw await parseApiError(response);
      const sample = await response.json() as AnalysisResult;
      if (controller.signal.aborted) return false;
      setResult(sample);
      setRunStatus(null);
      setRunId(null);
      setStatusUrl(null);
      setIsSample(true);
      setPhase("result");
      return true;
    } catch (caught) {
      if (controller.signal.aborted) return false;
      if (typeof caught === "object" && caught !== null && "code" in caught) showError(caught as UiError);
      else showError({ code: "SAMPLE_UNAVAILABLE", message: caught instanceof Error ? caught.message : "The Edmonton sample is unavailable.", retryable: true });
      return false;
    }
  }, [showError]);

  const stageCanadaBuysUrl = useCallback((url: string) => {
    if (!isCanadaBuysUrl(url)) throw new Error("Provide an HTTPS URL on canadabuys.canada.ca.");
    requestRef.current?.abort();
    idempotencyKeyRef.current = null;
    setMode("url");
    setUrlDraftsState((current): UrlDraft[] => {
      const base = current.find((draft) => draft.role === "base");
      if (!base) return [{ id: newId("url"), role: "base" as const, url }, ...current.map((draft) => ({ ...draft, role: "amendment" as const }))].slice(0, MAX_FILES);
      return current.map((draft) => draft.id === base.id ? { ...draft, url } : draft);
    });
    setRunId(null);
    setStatusUrl(null);
    setRunStatus(null);
    setResult(null);
    setIsSample(false);
    setUiError(null);
    setValidationError(null);
    setPhase("idle");
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(".url-field input")?.focus();
      document.getElementById("top")?.scrollIntoView({ block: "start" });
    });
  }, []);

  useEffect(() => {
    const context = document.modelContext;
    if (!context || typeof context.registerTool !== "function") return;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    void Promise.allSettled([
      context.registerTool({
        name: "load_edmonton_sample",
        title: "Load Edmonton sample",
        description: "Load the built-in verified Edmonton procurement sample into the current RFP X-Ray workspace. This changes the visible workspace but does not upload or analyze a new document.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (_input, execution) => {
          const loaded = await loadSample(execution.signal);
          if (!loaded) {
            if (execution.signal.aborted) throw execution.signal.reason;
            throw new Error("The Edmonton sample could not be loaded.");
          }
          return JSON.stringify({ loaded: true, sample: "Edmonton 100022184-A", source_scope: "document_only" });
        },
      }, options),
      context.registerTool({
        name: "stage_canadabuys_url",
        title: "Stage CanadaBuys URL",
        description: "Validate and place one HTTPS canadabuys.canada.ca URL into the base-document field. This only stages the URL for user review and never starts analysis.",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string", format: "uri", description: "HTTPS URL hosted on canadabuys.canada.ca" } },
          required: ["url"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: ({ url }) => {
          if (typeof url !== "string") throw new TypeError("url must be a string");
          stageCanadaBuysUrl(url);
          return JSON.stringify({ staged: true, url, analysis_started: false });
        },
      }, options),
    ]);
    return () => controller.abort();
  }, [loadSample, stageCanadaBuysUrl]);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    if (phase !== "polling" || !runId || !statusUrl) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch(statusUrl, { credentials: "same-origin", signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw await parseApiError(response);
        const status = await response.json() as RunStatusResponse;
        if (controller.signal.aborted) return;
        setRunStatus(status);

        if (status.status === "ready" || status.status === "partial") {
          if (!status.cleanup_confirmed) {
            showError({ code: "SOURCE_CLEANUP_PENDING", message: "The API reported a result state before source cleanup was confirmed. The result remains hidden.", retryable: true, requestId: status.error?.request_id });
            return;
          }
          const resultResponse = await fetch(`/api/v1/runs/${runId}/analysis`, { credentials: "same-origin", signal: controller.signal, cache: "no-store" });
          if (resultResponse.status === 202) {
            timer = setTimeout(poll, POLL_INTERVAL_MS);
            return;
          }
          if (!resultResponse.ok) throw await parseApiError(resultResponse);
          const payload = await resultResponse.json() as AnalysisResult;
          if (controller.signal.aborted) return;
          setResult(payload);
          setIsSample(false);
          setPhase("result");
          return;
        }
        if (status.status === "failed" || status.status === "expired") {
          setRunId(null);
          setStatusUrl(null);
          showError(status.error ? {
            code: status.error.code,
            message: status.error.message,
            retryable: status.error.retryable,
            requestId: status.error.request_id,
          } : {
            code: status.status === "expired" ? "EXPIRED" : "ANALYSIS_INCOMPLETE",
            message: stageCopy[status.status].detail,
            retryable: status.status !== "expired",
          });
          return;
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (typeof caught === "object" && caught !== null && "code" in caught) showError(caught as UiError);
        else showError({ code: "STATUS_UNAVAILABLE", message: caught instanceof Error ? caught.message : "Run status is unavailable.", retryable: true });
      }
    };

    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [phase, pollRevision, runId, showError, statusUrl]);

  const sourceCount = useMemo(() => mode === "url" ? urlDrafts.length : fileDrafts.length, [fileDrafts.length, mode, urlDrafts.length]);

  const validateSources = useCallback(() => {
    if (sourceCount < 1 || sourceCount > MAX_FILES) return "Select between one and five source documents.";
    if (mode === "url") {
      if (urlDrafts.some((draft) => !isCanadaBuysUrl(draft.url.trim()))) return "Every URL must use HTTPS on canadabuys.canada.ca.";
      if (urlDrafts.filter((draft) => draft.role === "base").length !== 1) return "Choose exactly one base RFP. Mark every other document as an amendment.";
    } else {
      if (fileDrafts.some((draft) => draft.file.size > MAX_FILE_BYTES)) return "Each PDF must be 25 MB or smaller.";
      if (fileDrafts.some((draft) => !draft.file.name.toLowerCase().endsWith(".pdf") && draft.file.type !== "application/pdf")) return "Every selected file must be a PDF.";
      if (fileDrafts.filter((draft) => draft.role === "base").length !== 1) return "Choose exactly one base RFP. Mark every other file as an amendment.";
    }
    return null;
  }, [fileDrafts, mode, sourceCount, urlDrafts]);

  const startAnalysis = useCallback(async () => {
    lastActionRef.current = "analysis";
    const error = validateSources();
    if (error) {
      setValidationError(error);
      setPhase("idle");
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".form-error")?.focus());
      return;
    }

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setUiError(null);
    setValidationError(null);
    setResult(null);
    setRunStatus(null);
    setRunId(null);
    setStatusUrl(null);
    setIsSample(false);
    setPhase("starting");
    setLocalProgress(6);
    setLocalMessage(mode === "upload" ? "Preparing private PDF uploads" : "Validating CanadaBuys links");

    try {
      let documents: CreateRunRequest["documents"];
      if (mode === "url") {
        documents = urlDrafts.map((draft) => ({ role: draft.role, source: { type: "url" as const, url: draft.url.trim() } }));
      } else {
        documents = [];
        for (let index = 0; index < fileDrafts.length; index += 1) {
          const draft = fileDrafts[index];
          setLocalMessage(`Securing ${draft.file.name}`);
          setLocalProgress(8 + Math.round((index / fileDrafts.length) * 34));
          const sha256 = await sha256Hex(draft.file);
          const presignResponse = await fetch("/api/v1/uploads/presign", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ filename: draft.file.name, size_bytes: draft.file.size, sha256 }),
            signal: controller.signal,
          });
          if (!presignResponse.ok) throw await parseApiError(presignResponse);
          const presign = await presignResponse.json() as PresignUploadResponse;
          const uploadResponse = await fetch(presign.upload_url, {
            method: presign.method,
            headers: presign.headers,
            body: draft.file,
            signal: controller.signal,
          });
          if (!uploadResponse.ok) throw { code: "UPLOAD_FAILED", message: `${draft.file.name} could not be transferred.`, retryable: true } satisfies UiError;
          documents.push({
            role: draft.role,
            source: { type: "upload", blob_path: presign.blob_path, sha256, size_bytes: draft.file.size, filename: draft.file.name },
          });
        }
      }

      setLocalMessage("Starting document-only analysis");
      setLocalProgress(46);
      const idempotencyKey = idempotencyKeyRef.current ?? newId("run");
      idempotencyKeyRef.current = idempotencyKey;
      const response = await fetch("/api/v1/runs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ documents } satisfies CreateRunRequest),
        signal: controller.signal,
      });
      if (!response.ok) throw await parseApiError(response);
      const created = await response.json() as CreateRunResponse;
      if (controller.signal.aborted) return;
      idempotencyKeyRef.current = null;
      setRunId(created.run_id);
      setStatusUrl(resolveStatusUrl(created.run_id, created.status_url));
      setLocalProgress(50);
      setPhase("polling");
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (typeof caught === "object" && caught !== null && "code" in caught) showError(caught as UiError);
      else showError({ code: "START_FAILED", message: caught instanceof Error ? caught.message : "The analysis could not be started.", retryable: true });
    }
  // Source arrays are intentionally dependencies because retry uses the currently reviewed pack.
  }, [fileDrafts, mode, showError, urlDrafts, validateSources]);

  function submitSources(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void startAnalysis();
  }

  function retry() {
    if (lastActionRef.current === "sample") {
      void loadSample();
      return;
    }
    if (runId && statusUrl) {
      setUiError(null);
      setPhase("polling");
      setPollRevision((current) => current + 1);
      return;
    }
    void startAnalysis();
  }

  async function deleteResult() {
    if (!runId) {
      resetToInputs();
      return;
    }
    const response = await fetch(`/api/v1/runs/${runId}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok && response.status !== 204) {
      const error = await parseApiError(response);
      throw new Error(error.message);
    }
    resetToInputs();
  }

  return (
    <div className="app-shell" id="top">
      <a className="skip-link" href="#main-content">Skip to workspace</a>
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="RFP X-Ray workspace home"><span className="wordmark-icon"><ScanText aria-hidden="true" size={20} strokeWidth={ICON_STROKE} /></span><span>RFP X-Ray</span></a>
        <div className="topbar-actions">
          <span className="scope-lock"><LockKeyhole aria-hidden="true" size={15} />Document-only. No search.</span>
          <a href="/api/openapi.json" target="_blank" rel="noreferrer">API</a>
        </div>
      </header>

      {phase === "idle" ? (
        <main className="workspace" id="main-content">
          <SourceBuilder
            fileDrafts={fileDrafts}
            mode={mode}
            onLoadSample={() => void loadSample()}
            onSubmit={submitSources}
            setFileDrafts={setFileDrafts}
            setMode={setMode}
            setUrlDrafts={setUrlDrafts}
            urlDrafts={urlDrafts}
            validationError={validationError}
          />
          <SamplePanel loading={false} onLoadSample={() => void loadSample()} />
        </main>
      ) : null}

      {phase === "starting" ? <ProgressSurface localMessage={localMessage} localProgress={localProgress} onStop={resetToInputs} status={null} /> : null}
      {phase === "polling" ? <ProgressSurface localMessage={localMessage} localProgress={localProgress} onStop={resetToInputs} status={runStatus} /> : null}
      {phase === "error" && uiError ? <ErrorSurface error={uiError} onBack={resetToInputs} onRetry={retry} /> : null}
      {phase === "result" && result ? (
        <main className="analysis-page" id="main-content">
          <AnalysisSurface isSample={isSample} onDelete={deleteResult} onReset={resetToInputs} result={result} runId={runId} runStatus={runStatus} />
        </main>
      ) : null}
    </div>
  );
}
