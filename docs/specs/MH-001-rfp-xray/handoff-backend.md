# Backend Implementation Handoff

> Historical implementation handoff. Revisions 1–5 preserve the evidence
> available at each handoff and are superseded by Revision 6 for current schema,
> test, audit, and runtime status. The current path uses Vercel Node 22 with
> Fluid Compute, deployment-bound runtime/provider attestations, bounded
> parallel Monid parsing, and a dedicated Railway private Bucket. See
> `runtime-decision.md` and `release-evidence/railway-storage-probe.md`.

## Assignment

Implemented MH-001 T2: the API, run lifecycle, PDF/evidence pipeline, provider adapters,
cleanup controls, quotas, persistence schema, workflow entry point, deterministic
samples/fixtures, and backend test coverage. This is implementation evidence only;
it is not a self-certification or QA verdict.

## Inspected Files

- `AGENTS.md`
- `docs/agents/chief_agent.md`
- `docs/agents/roles/backend.md`
- `docs/agent_context/current_task_brief.md`
- `docs/agent_context/current_system_state.md`
- `docs/agent_context/known_risks.md`
- `docs/agent_context/qa_regressions.md`
- `docs/specs/MH-001-rfp-xray/{spec.md,plan.md,tasks.md,agent_routing.yaml,qa_gate.yaml,provider-contract.md,handoff-chief.md}`
- All frozen files under `src/contracts/`
- Existing package/build/test configuration and installed dependency APIs needed to
  use PDF.js, OpenAI, Neon Drizzle, Vercel Blob, and Vercel Workflow.
- Official PDFs from the external, non-repository fixture directory
  `C:\Users\chen0\AppData\Local\Temp\rfp-xray-fixtures` for local verification only.

## Changed Files

- Public API: `src/app/api/health/route.ts`,
  `src/app/api/openapi.json/route.ts`, and every route under `src/app/api/v1/`.
- API/runtime core: `src/lib/api/{http,openapi}.ts`, `src/lib/{config,crypto,errors,logging,pipeline,cleanup,source-validation}.ts`.
- Analysis/evidence: every file under `src/lib/analysis/`,
  `src/lib/evidence/citations.ts`, and `src/lib/pdf/{page-index.ts,pdfjs-worker.d.ts}`.
- Providers/storage/security: every file under `src/lib/providers/`,
  `src/lib/storage/`, `src/lib/security/`, and `src/lib/questions/audit-store.ts`.
- Run lifecycle: every file under `src/lib/runs/`.
- Persistence/workflows: `src/db/{schema,neon-store}.ts`,
  `drizzle/0000_rfp_xray.sql`, and every file under `src/workflows/`.
- Deterministic data: `src/lib/fixtures/{edmonton,cer}.ts`.
- Tests: every file under `tests/unit/`, `tests/integration/`, and `tests/golden/`.
- This handoff only under governance paths. Frozen `src/contracts/**` was not edited.

`next build` rewrote the generated imports in `next-env.d.ts` from `.next/dev/types`
to `.next/types`. That generated, out-of-scope diff was not manually edited and is
left for the root integrator to disposition.

## Decisions

- The locked primary routes are:
  `POST /api/v1/uploads/presign`, `POST /api/v1/runs`,
  `GET|DELETE /api/v1/runs/{run_id}`,
  `GET /api/v1/runs/{run_id}/analysis`,
  `POST /api/v1/runs/{run_id}/questions`,
  `GET /api/v1/samples/edmonton`, `GET /api/health`, and
  `GET /api/openapi.json`. `/result`, `/sample`, and the two `/api/v1` metadata
  endpoints remain compatibility aliases only.
- Local execution deliberately uses in-memory run/blob/budget/question stores and a
  deterministic model whenever the complete live credential set is absent. Live
  Vercel execution selects Neon, private Blob, Monid, OpenAI, and Workflow adapters.
- The live provider pipeline stays in one Workflow step so raw PDF text and parser
  markdown never become durable Workflow arguments/results. Whole-step retries are
  disabled (`processRunStep.maxRetries = 0`) to prevent duplicate paid calls after a
  late failure. The generated Workflow endpoint uses `maxDuration="max"`; the source
  declares an 800-second ceiling, the aggregate source/Monid network phase is capped
  at 600 seconds, and OpenAI gets one 120-second attempt. Therefore live provider
  deployment requires Vercel Pro with Fluid Compute; Hobby is suitable only for the
  local/sample fallback. Vercel documents 300 seconds max on Hobby and 800 seconds on
  Pro/Enterprise in the stable limit table:
  https://vercel.com/docs/functions/limitations
- After analysis, the workflow performs a durable, non-compute sleep until the run's
  expiry and invokes an idempotent expiry step. Owned reads also expire overdue runs,
  and DELETE uses the same cleanup path.
- Monid is isolated behind configurable provider/endpoint and response paths. The
  adapter sends the specified nested `/v1/run` request, polls lifecycle state, checks
  the nested provider HTTP status, and refuses to infer an artifact URL.
- Physical PDF pages are indexed strictly 1-based with PDF.js. The worker is imported
  explicitly so Turbopack includes the server fake-worker implementation. JavaScript
  actions are detected but never executed.
- Model output contains candidate quotes and opaque chunk ids, never trusted page
  numbers. Server-side verification resolves exact/normalized quotes against the
  SHA-bound page index and emits document-, representation-, fragment-, method-, and
  version-bound receipts. Unsupported critical claims are removed.
- Amendment reconciliation is deterministic independent of upload order, retains
  superseded history, and preserves base plus competing amendment citations on
  unresolved conflicts.
- Application-controlled source blobs/staging bytes are deleted before model
  extraction. Page text and parsed markdown are cleared before READY/PARTIAL.
  READY/PARTIAL is impossible until all expected application cleanup receipts say
  `deleted`. Provider artifact deletion/retention is outside application control and
  remains explicitly `unknown`, not falsely represented as deleted.
- V1 Q&A deliberately answers only from the persisted, verified result after raw
  cleanup. It does not make another model call, browse, follow links, or retain the
  raw question; the audit stores only its SHA-256, answerability, and citation count.
- Ten questions per run are enforced by a serialized local counter or a Neon
  advisory-lock transaction. One active run per owner is enforced before creation by
  the local store and a Neon partial unique index. Idempotent replay is resolved first.
- Guest mutations require a signed HttpOnly session and, in production, Turnstile.
  API clients use a SHA-256-registered bearer key. Upload paths/tokens are owner-bound.

## Confirmed

- Exact URL-source validation accepts HTTPS only on `canadabuys.canada.ca`, rejects
  credentials, non-443 ports, deceptive suffixes/subdomains, and bounds a package to
  5 PDFs, 25 MiB each, and 300 aggregate pages.
- Signed uploads bind owner, opaque blob path, declared size, SHA-256, and expiry;
  direct PUT is streamed with a hard byte bound.
- Run creation/status/result/idempotency/delete, immutable owner identity, allowed
  state transitions, cleanup gating, budget reservation/settlement, daily run quota,
  one-active-run quota, and ten-question quota have automated coverage.
- OpenAI uses `responses.parse` with `zodTextFormat`, `store:false`, no tools, bounded
  document input, document-only instructions, a 120-second timeout, and no SDK retry.
- The deterministic Edmonton sample reports 55 physical pages (47-page body plus
  8-page form), M1-M4, M3's up-to-three limit, blank price as unknown, lowest-price
  basis, and the Annex D/E conflict. CER fixtures preserve the base/amendment closing
  dates, 2050/2055 horizon conflict, superseded history, and three-source citations.
- External official-file audit matched all five supplied SHA-256 values and page
  counts: Edmonton 55; CER main 58; amendments 6, 2, and 9 pages. No PDF or full raw
  extracted text was added to Git.
- A clean production Next server smoke used the official Edmonton PDF without live
  provider credentials. Observed: presign PUT contract; upload 204; create 202;
  idempotent repeat 200 with the same run id; distinct second active run 429
  `RATE_LIMITED`; terminal `partial`; cleanup confirmed true; analysis 200/schema 1.0;
  questions 1-10 returned 200; question 11 returned 429 `RATE_LIMITED`; DELETE 204;
  subsequent status `expired` with cleanup still confirmed. No paid API was called.

## Inferred

- The current Context.dev parse request is expected to be
  `{provider, endpoint, input:{body:{file_url, extension, ocr, includeLinks:false,
  includeImages:false, shortenBase64Images:true, useMainContentOnly:false}}}` and the
  provider reserve is 4,500 micro-USD per document. This came from the task packet,
  not a credentialed inspection in this implementation run.
- A one-step live pipeline avoids creating an additional durable copy of sensitive
  raw/parsed material. With the enforced 600 + 120 second external-call budgets,
  bounded inputs, and the measured official five-PDF indexing audit (about 4 seconds
  in the final run), an 800-second Pro step has approximately 80 seconds of remaining
  headroom. This is an architectural bound, not production latency evidence.
- A `cost.value` accompanied by currency `USD` represents dollars and is converted to
  integer micro-USD. Unrecognized/missing cost data remains estimated rather than
  fabricated.

## Unknown

- The live Monid `/v1/inspect`, start, polling, nested provider status, cost, and
  artifact response shapes were not credential-verified. `MONID_RESULT_URL_PATH` is
  intentionally mandatory, and other paths remain configurable.
- Monid/Context.dev provider artifact retention and deletion capability remain
  unknown. Application cleanup does not claim control over provider storage.
- No live OpenAI, Monid, Neon, Blob, Turnstile, or deployed Workflow call was made.
  Deployment connectivity, permissions, actual provider cost, and end-to-end latency
  therefore remain unverified.
- The P95 under 10 minutes, 300 concurrent readers, accessibility, and browser/mobile
  acceptance criteria require independent/deployed QA.

## Checks and Exact Outcomes

- `pnpm typecheck`: PASS, exit 0.
- `pnpm lint`: PASS, exit 0, including the requested prefer-const/warning cleanup.
- `pnpm test`: PASS, 13 test files passed and 1 optional file skipped; 33 tests passed
  and 2 skipped. The skipped cases require the external official-fixture directory.
- `$env:RFP_XRAY_FIXTURE_DIR='C:\Users\chen0\AppData\Local\Temp\rfp-xray-fixtures'; pnpm vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 2 tests, no PDFs committed.
- Targeted quota integration:
  `pnpm vitest run tests/integration/api-contract.test.ts tests/integration/question-limit.test.ts`:
  PASS, 2 files and 4 tests.
- `pnpm build`: PASS. Next compiled, ran TypeScript, generated all pages, and Workflow
  reported `7 steps, 1 workflow`. Build route output includes every locked public path.
- Final production HTTP smoke: PASS with exact observations recorded under Confirmed.
  PDF.js emitted the upstream warning `TT: undefined function: 32` for the official
  file but indexed all pages and completed the run successfully.

## Assumptions

- Live deployment will apply `drizzle/0000_rfp_xray.sql` before accepting traffic and
  will supply database/blob/provider/auth/Turnstile secrets through the platform.
- Live provider execution will use Vercel Pro with Fluid Compute and permit the
  Workflow-generated step endpoint to use the declared 800-second maximum.
- The product enforces daily defaults (3 guest runs/day, 30 API runs/day) in
  addition to one active run and the global daily cost budget.
- CanadaBuys is the sole supported URL origin in v1; other PDFs use signed upload.

## Risks

- Deploying the live provider pipeline on Hobby can terminate a legitimate run at
  300 seconds. Use Pro/Fluid or redesign the pipeline around encrypted, explicitly
  retained intermediate artifacts and multiple shorter steps.
- A process crash after a paid call but before persistence cannot safely replay the
  one-step pipeline automatically; retries are intentionally disabled to prevent
  duplicate spend. The run may fail and require a new user-authorized submission.
- Local memory adapters are for development/E2E only and are neither multi-instance
  durable nor cross-process atomic. Production must configure Neon and Blob.
- The partial unique index and question advisory-lock logic provide the production
  concurrency guarantees only after the migration is applied.
- Workflow expiry sleep plus lazy expiry provides two cleanup paths, but an external
  scheduled sweep remains a useful operational backstop for deleted/corrupt workflow
  metadata.

## Follow-ups

- Independently review this implementation against `qa_gate.yaml`; do not accept this
  handoff as certification.
- In a credentialed staging environment, call Monid inspect once, validate the exact
  Context.dev contract, configure every required response path, and add a recorded
  contract test with secrets and provider payloads redacted.
- Apply the Neon migration, configure private Blob, API/session/IP/Turnstile secrets,
  select explicit OpenAI models, enable Pro Fluid Compute, and verify the generated
  Workflow function duration before exposing live analysis.
- Run deployed cleanup-failure, provider-timeout, function-timeout, concurrent-create,
  concurrent-question, TTL-expiry, accessibility, and 300-reader load tests.
- Decide whether to keep or revert the build-generated `next-env.d.ts` import change.

## Proposed Long-Term Memory

- MH-001 v1 primary paths use `/analysis`, `/samples/edmonton`, `/api/health`, and
  `/api/openapi.json`; `/result` and `/sample` are aliases only.
- Physical PDF citations are 1-based and accepted only after SHA-bound server-side
  quote verification; model-supplied page numbers are never authoritative.
- READY/PARTIAL requires confirmed deletion of every application-controlled raw
  resource; provider retention is separately disclosed as unknown.
- V1 Q&A is post-cleanup, closed-world retrieval from persisted verified evidence,
  capped at ten questions per run.
- Live one-step Workflow execution requires Pro/Fluid, has zero whole-step retries,
  and uses 600-second network plus 120-second OpenAI budgets under an 800-second cap.

## Memory Disposition

Proposed only. Promotion or rejection belongs to the root/reviewer workflow.

---

## Revision 1 — Cleanup, Concurrency, Grounding, and Spend Hardening

This revision responds to the first independent Reviewer verdict in `qa_report.md`
(`REQUEST_CHANGES`: one P0 and six consolidated P1 findings). It is implementation
evidence for another review, not a self-certification. No deployment, migration,
credentialed provider call, paid API call, or repository commit was performed.

### Exact Revision 1 Files

- Runtime/config/dependencies: `.env.example`, `package.json`, `pnpm-lock.yaml`,
  `vercel.json`.
- Persistence: `drizzle/0000_rfp_xray.sql`,
  `drizzle/0001_revision1_privacy.sql`, `src/db/schema.ts`,
  `src/db/neon-store.ts`.
- API routes: `src/app/api/internal/maintenance/route.ts`,
  `src/app/api/v1/health/route.ts`, `src/app/api/v1/runs/route.ts`,
  `src/app/api/v1/runs/[runId]/route.ts`,
  `src/app/api/v1/runs/[runId]/result/route.ts`,
  `src/app/api/v1/runs/[runId]/questions/route.ts`, and
  `src/app/api/v1/uploads/presign/route.ts`.
- Analysis/providers/storage: `src/lib/analysis/draft.ts`,
  `src/lib/analysis/materialize.ts`, `src/lib/analysis/reconciliation.ts`,
  `src/lib/cleanup.ts`, `src/lib/config.ts`, `src/lib/pipeline.ts`,
  `src/lib/providers/monid.ts`, `src/lib/providers/openai.ts`,
  `src/lib/questions/audit-store.ts`, `src/lib/storage/source-reader.ts`, and
  `src/lib/storage/uploads.ts`.
- Run/security lifecycle: `src/lib/runs/create.ts`, `src/lib/runs/expiry.ts`,
  `src/lib/runs/scheduler.ts`, `src/lib/runs/store.ts`,
  `src/lib/runs/types.ts`, `src/lib/security/auth.ts`, and
  `src/lib/security/budget.ts`.
- Workflows: `src/workflows/analyze-run.ts`,
  `src/workflows/retry-cleanup-step.ts`, `src/workflows/retry-cleanup.ts`,
  `src/workflows/sweep-incoming-uploads-step.ts`, and
  `src/workflows/sweep-incoming-uploads.ts`.
- Tests: `tests/integration/cleanup-gate.test.ts`,
  `tests/integration/pipeline-claim.test.ts`,
  `tests/integration/retention-cleanup.test.ts`,
  `tests/integration/upload-lifecycle.test.ts`,
  `tests/unit/maintenance-route.test.ts`,
  `tests/unit/materialize-reconciliation.test.ts`,
  `tests/unit/monid-adapter.test.ts`, `tests/unit/openai-adapter.test.ts`,
  `tests/unit/production-readiness.test.ts`, `tests/unit/turnstile.test.ts`, and
  `tests/unit/vercel-upload-recovery.test.ts`.
- Governance evidence: this `handoff-backend.md` revision section.

The root-owned API-contract and golden-fixture revision agents separately changed
their carved-out paths; those paths are intentionally not claimed in the list above.

### Implemented Corrections

- Result persistence and reads now require both a terminal `ready|partial` status and
  `cleanupConfirmed`. Cleanup failure keeps the run in `cleanup_pending`, withholds
  result/citation data, and makes DELETE return an explicit 503 instead of a false
  204. Cleanup retries are bounded and idempotent.
- Every input has a deterministic staging target derived from run id and document
  index, registered before source I/O. Upload targets are also pre-registered and
  pre-claimed. Empty cleanup ledgers cannot satisfy the gate.
- Signed-PUT grants have a durable owner/path/SHA/size/claim/expiry ledger. Staging
  uses an immutable destination, source-ETag conditional copy for uploads, and an
  uncached exact-size/SHA readback. A retry after the object write but before ledger
  persistence accepts only identical staged bytes; a mismatch fails closed.
- After verified staging, incoming upload content is immediately replaced using an
  ETag-conditional zero-byte fence. Monid receives only a temporary private staging
  URL. Each document's stage is conditionally deleted as soon as that document's
  Monid representation is captured; the incoming tombstone stays until signed-grant
  expiry plus five minutes so `allowOverwrite:false` continues to reject replay.
- Abandoned upload cleanup has a per-grant workflow and a five-minute authenticated
  maintenance cron. The durable sweeper uses CAS leases, versions, attempts, retry
  release, a 30-minute hard deadline, and hashed-only overdue logging.
- Processing uses a run-level CAS lease and fencing counter. Concurrent
  `processRun` calls reach paid providers and cleanup through one owner only.
- Early delete and 24-hour expiry scrub source names/URLs/blob paths, input,
  idempotency/request hashes, manifests, results, citation receipts, and workflow
  metadata. Only non-body cost and hashed cleanup audit remains for at most 30 days.
  Provider artifact deletion is still not claimed.
- Summary factual fields are retained only when they exactly match a verified active
  claim/requirement/evaluation value; otherwise they become neutral/null. Empty or
  unverifiable extraction is `incomplete`, and the run is never `ready`. Coverage,
  citation, unsupported-item, and critical-claim counts are computed from materialized
  evidence rather than hard-coded.
- Claims and requirements reconcile independently from server-derived document role
  and amendment number. Model-supplied amendment ordering is non-authoritative.
  Deletes remain internal tombstones, current-stage evidence drives conflicts, and an
  internal same-amendment conflict uses the locked safe answer.
- Production now fails closed unless Neon, private Blob, credentialed replay-fence
  validation, Vercel Workflow, every Monid normalization/artifact-host setting,
  OpenAI, session/IP secrets, Turnstile site/secret/hostname, and cron secret are
  ready. Memory, local Blob, deterministic model, and microtask scheduling remain
  development/test-only.
- Guest mutation verification freezes header `X-Turnstile-Token` and actions
  `upload_presign`, `create_run`, `ask_question`, and `delete_run`. Siteverify must
  return success plus the expected action and hostname, and that hostname must match
  the request URL. API bearer clients remain the explicit non-guest path.
- OpenAI is pinned to the benchmarked `gpt-5.4-mini`; unknown model names fail config
  validation. All deterministic batches are serialized before generation, capped at
  1.2 MB total/140 KB per request, and exact-counted with
  `beta.responses.inputTokens.count`, including instructions and the Structured
  Output schema. The 320,000 input-token and 50,000 total output-token ceilings have
  a worst-case estimate of 465,000 micro-USD at $0.75/M input and $4.50/M output,
  below the 495,000 micro-USD reservation.
- Model batches consume Monid Markdown once rather than duplicating it with PDF.js
  chunks. A dense synthetic 300-page package over 900 KB passes batching/preflight.
  No input or combined model output is silently truncated. Cross-batch evaluation is
  selected as one coherent object with only its own citations. A late batch failure
  retains returned response ids/usage plus every attempted batch's preflight input
  count and a conservative failed-output estimate; pipeline cost settlement no
  longer clamps actual estimated usage to the reservation.
- Monid artifact fetching permits only exact configured HTTPS hosts on port 443,
  resolves only public network addresses, follows redirects manually with validation
  at every hop, bounds control JSON/string/array data, and logs safe metadata only.
- `nanoid` is overridden to 5.1.16 and `undici` to 7.29.0. The high-severity audit
  gate is clean; one moderate advisory remains below the requested threshold.

### Revision 1 Verification Evidence

- `pnpm check`: PASS, exit 0. ESLint and TypeScript passed; Vitest reported 21 files
  passed, 1 optional file skipped, 78 tests passed, and 3 skipped.
- `$env:RFP_XRAY_FIXTURE_DIR='C:\Users\chen0\AppData\Local\Temp\rfp-xray-fixtures'; pnpm exec vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, exit 0; 1 file and 3 tests passed. The official PDFs stayed outside Git.
- `pnpm build`: PASS, exit 0. Next compiled and type-checked; Workflow reported 9
  steps and 3 workflows. Route output includes the locked public routes and
  `/api/internal/maintenance`.
- `pnpm audit --audit-level=high`: PASS, exit 0; zero high findings and one moderate
  finding.
- `git diff --check`: no whitespace errors; only Windows LF-to-CRLF notices.
- No automated test contacted OpenAI, Monid, Neon, Vercel Blob, Turnstile, or a
  deployed Workflow. Provider and Blob tests use injected/mocked adapters.
- On 2026-09-02 MDT, a credentialed read-only contract probe called
  `beta.responses.inputTokens.count` for `gpt-5.4-mini` with a short string and
  returned `input_tokens=16`. No secret or document content was printed. This
  proves the pinned model/count endpoint is available to the configured account;
  it does not prove structured extraction quality or maximum-context capacity.

### Remaining Unknowns and Required Independent Proof

- Vercel's signed PUT has no documented revoke/one-time operation. The zero-byte
  fence design is therefore production-disabled until a credentialed stress test
  proves ETag CAS behavior and proves that an unexpired `allowOverwrite:false` URL
  cannot replace the fence. `BLOB_REPLAY_FENCE_VALIDATED=false` remains the default;
  production readiness reports unavailable until an operator explicitly changes it.
- Local/mocked tests prove control flow, not Vercel Blob consistency or credential
  permissions. They do not substantiate a production one-use claim. The immediate
  fence avoids waiting for grant expiry, but the 60-second post-capture cleanup SLO
  still needs credentialed timing evidence.
- Monid's exact live request/result/artifact contract and provider retention/deletion
  policy remain unverified. Provider-side retention is disclosed as unknown.
- Exact OpenAI token preflight is live-verified only for a 16-token probe;
  structured generation remains SDK-shape tested only. The dense 300-page case
  proves local capacity/budget behavior, not live extraction recall or the 100%
  mandatory-requirement target.
- The 800-second single privacy step still requires Vercel Pro/Fluid Compute. Its
  P95, cron delivery, crash behavior, and deployed lease recovery need staging/load
  evidence; no Railway dependency was introduced.
- The Neon migration was authored but not applied. Production index/transaction
  behavior and 300-reader concurrency remain for independent deployed QA.

---

## Revision 2 — Cancellation and Evidence-Truth Integration

This root-integrated revision supersedes any earlier implementation wording in this
handoff where the details differ. It remains implementation evidence, not a Reviewer
verdict.

- Upload staging no longer relies on ambiguous Blob `copy(..., { ifMatch })`
  semantics. The server writes the exact size/SHA-verified bytes with immutable
  `put(..., { allowOverwrite:false })`, then performs an uncached size/SHA readback.
- DELETE, TTL expiry, and stale-worker recovery revoke the processing lease and bump
  its fence before cleanup. `cleanup_pending` cannot return to an analysis/ready
  state. After the preserved lease deadline, cleanup re-deletes and reconfirms every
  durable source/stage so a late stale write cannot hide behind an old receipt.
- Five-minute maintenance now uses an indexed, server-filtered, 100-row cleanup
  candidate query. It handles result expiry, 30-day audit purge, and crashed workers
  whose 20-minute processing lease expired; it does not load the whole run table.
- Only process-local page text and parsed Markdown receive synthetic release receipts,
  and only after worker quiescence. Application-controlled durable objects still
  require adapter-confirmed deletion in the final cleanup pass.
- `unknown` claims cannot replace/delete facts, create conflicts, support summaries,
  or satisfy readiness. Citation SHA must match the fact's source document, and
  asserted numeric/date/time tokens must occur in its evidence.
- Summary support is field-specific. Evaluation is a set of separately cited,
  versioned rules (`mandatory_gate`, `rated_threshold`, `technical_weight`,
  `financial_weight`, `selection_method`) reconciled in server-derived amendment
  order. Risks are versioned too. One quote can no longer bless an entire evaluation.
- Same-amendment distinct scalar values conflict even when the model labels them
  `add` or varies topic wording. Replace/delete/supersede operations require verified
  source evidence. Package completeness is conservatively `unverified` without an
  authoritative inventory and `incomplete` for missing/mixed solicitation metadata,
  amendment gaps, or duplicates.
- A credentialed token-count probe verified the pinned `gpt-5.4-mini` and
  `beta.responses.inputTokens.count` endpoint (`input_tokens=16`). A second paid
  probe used only synthetic tender text and the exact `DraftAnalysisSchema`; live
  `responses.parse` returned schema-valid output with 1,063 input tokens, 1,168
  output tokens, 4 claims, 2 requirements, and 2 independently structured
  evaluation rules. This proves endpoint/schema compatibility, not RFP recall.
  Monid, Neon, Blob, Turnstile, Workflow, and deployment remain unverified.

### Latest Integrated Verification

- `pnpm check`: PASS; 22 test files passed, 1 optional file skipped; 90 tests passed,
  3 fixture-dependent tests skipped.
- Official external fixture audit with `RFP_XRAY_FIXTURE_DIR` set: PASS, 3/3.
- `pnpm build`: PASS; 9 Workflow steps, 3 workflows, and all locked/API compatibility
  routes compiled.
- `CI=1 pnpm test:e2e`: PASS, 14/14 across desktop Chromium and mobile viewport.
- `pnpm audit --audit-level=high`: PASS at the configured gate; zero high findings,
  one moderate advisory.
- `git diff --check`: PASS; only Git's Windows LF-to-CRLF notices were emitted.

---

## Revision 3 — Release-Candidate Truth, Recovery, and Upload Admission

This working-tree revision responds to the exact-commit review of `230e382` and
the specialist adversarial/security audits. It is a candidate for independent
re-review, not a self-certification, and it does not resolve the credentialed
deployment gates listed below.

### Implemented Corrections

- Every copied `modelInput[].parsed_markdown` value is cleared in a `finally`
  immediately after extraction. Cancellation after a paid call settles at least
  the locally observed Monid/model cost even when the revoked processing fence
  correctly blocks any later run-row write.
- OpenAI token preflight and all sequential extraction batches now share one
  aggregate 120-second monotonic deadline; each SDK call receives only the
  remaining time and `maxRetries:0`. Q&A similarly shares one 20-second phase
  deadline. A deterministic multi-batch test proves a second batch is not
  started after the shared deadline is exhausted.
- Run admission is resumable. An idempotent replay of `queued` plus null
  `workflowRunId` repeats upload claim and budget reserve idempotently and starts
  Workflow. The authenticated five-minute maintenance path also recovers a
  bounded, indexed set of stranded admissions after a one-minute grace period.
  Duplicate Workflow starts remain provider-safe because the run processing CAS
  lease admits only one worker.
- Neon budget reservation now treats an exact existing `run_id` reservation as
  a successful idempotent replay rather than misclassifying it as exhausted.
- Independent model batches that reuse IDs such as `risk-1` receive deterministic
  content-bound IDs before materialization. Direct ambiguous duplicates are
  withheld. A model-provided `supersedes_claim_ids` value is never mutation
  authority, and replace/delete behavior requires verified amendment operation
  language or a verified same-stage structural replacement directive.
- Server-derived projection-horizon semantics catch the CER 2050/2055 conflict
  even when model topics drift. Structural M3 rows remain row-scoped; the verified
  blanket Appendix 1 replacement authorizes all 37 replacement rows. Risks whose
  cited source clause is superseded are withheld even when the model omits a
  corresponding risk tombstone.
- Technical and financial percentages are bound to their labels; a swapped 30/70
  pair is rejected. Rated thresholds bind minimum and scale separately, so 50/94
  is accepted and 94-as-threshold is rejected. Summary fields require an anchor in
  the verified quote, and timezone/currency/percentage/magnitude/bound modifiers
  must agree with evidence.
- Presign issuance has durable atomic quotas: five outstanding grants per owner,
  guest/API daily document and byte limits, and a global daily byte limit. Neon
  advisory locks serialize owner, quota-key, and global boundaries. Grant cleanup
  releases the outstanding count while a separate quota event retains daily usage;
  a rejected quota attempt creates neither a grant row nor a signed PUT URL.

### Revision 3 Verification

- `pnpm check`: PASS; 22 files passed, 1 optional file skipped; 104 tests passed,
  3 skipped.
- Official fixture audit with `RFP_XRAY_FIXTURE_DIR` set: PASS, 3/3. Edmonton and
  all four CER package PDFs stayed outside Git.
- `pnpm build`: PASS; 9 Workflow steps, 3 workflows, and all public/internal routes
  compiled.
- `CI=1 pnpm test:e2e`: PASS, 14/14 desktop/mobile tests.
- `pnpm audit --audit-level=high`: PASS at the requested gate; zero high and one
  moderate advisory.
- Focused deadline, cancellation, admission recovery, evidence binding,
  reconciliation, stale-risk, upload quota, and Blob recovery tests all pass.

### Remaining External Gates

- Monid inspect/parse/artifact/cost/retention behavior, Vercel Private Blob
  replay-fence/CAS behavior, Neon migrations/concurrency, Workflow crash/cron
  behavior, Turnstile, and deployed Vercel Pro/Fluid duration are not credentialed
  live evidence yet. Production remains fail-closed until configured.
- Ten live Edmonton timings, one live four-document CER run, deployed load and
  accessibility evidence, and an independent Reviewer `APPROVE` are still required
  before public release or competition-complete claims.

---

## Revision 4 — Evidence Scope, Admission Fencing, and Cleanup Recovery

This candidate responds to the exact-commit review of `97c1417` and two
incremental adversarial audits. It remains subject to independent exact-commit
review and does not replace any credentialed provider/deployment gate.

### Implemented Corrections

- Run creation now acquires an atomic admission lease before upload claim,
  budget reservation, or Workflow start. Idempotent peers cannot schedule or
  fail the same row concurrently. Stale queued rows are recoverable even when a
  prior Workflow ID exists.
- Scheduler delivery errors are treated as ambiguous acknowledgement, not proof
  of failure. The queued row, source claim, budget reservation, old Workflow ID,
  and admission lease remain available for a delayed worker or bounded cron
  retry. Processing CAS still permits only one paid pipeline execution.
- Claims, requirements, and summary identity/deadline fields bind asserted
  values to their own label-local source spans. Explicit UTC offsets are
  objective tokens. Question and closing deadlines cannot borrow each other's
  dates/timezones across sentences, semicolons, newlines, or comma-delimited
  question anchors.
- Deadline reconciliation keys are derived only from a unique cited source
  clause containing the asserted objective tuple. Model value/topic text cannot
  manufacture scope from an adjacent solicitation label. Other replace/delete
  operations require a real mutation verb and source-clause object tokens;
  unsupported destructive operations become `needs_review` rather than
  superseding verified history.
- Stale-risk invalidation checks the complete finding, impact, and recommended
  action across pages, so a superseded date cannot survive merely by moving into
  another risk field.
- Monid parse objects retain only the run ID after copied Markdown is isolated;
  provider payload, artifact URL, and duplicate Markdown references are cleared.
- Guest/API run quotas are UTC-day based. Budget settlement is monotonic across
  retries. Upload quota events receive a bounded, indexed 30-day purge.
- Source purge reads the durable upload ledger first. If both ledger and object
  are absent it performs no Blob write; if only an orphan object exists it is
  conditionally removed. Replay fences require a live matching run claim and a
  successful ledger update, preventing untracked zero-byte objects.

### Revision 4 Verification

- `pnpm check`: PASS; 22 files passed, 1 optional file skipped; 122 tests passed,
  3 fixture-dependent tests skipped.
- Official external fixture audit: PASS, 3/3; all five PDFs remained outside Git.
- `pnpm build`: PASS; 9 Workflow steps, 3 workflows, and all routes compiled.
- `CI=1 pnpm test:e2e`: PASS, 14/14 desktop/mobile tests.
- `pnpm audit --audit-level=high`: PASS at the gate; zero high findings and one
  moderate development-only transitive esbuild advisory.
- `git diff --check`: PASS apart from Windows line-ending notices.

### Remaining External Gates

- Apply migration `0004_admission_and_quota_retention.sql` and verify real Neon
  concurrency/advisory-lock behavior.
- Verify Vercel Private Blob CAS, signed-PUT expiry, replay fencing, and deletion
  receipts with credentials.
- Verify Workflow enqueue ambiguity/recovery, Monid parse/cost/retention, deployed
  Turnstile, ten Edmonton timings, and the complete live CER package.

---

## Revision 5 — Durable Maintenance Liveness Gate

This working-tree revision replaces configuration-only cron readiness with
runtime evidence. It is implementation handoff, not an independent Reviewer
verdict.

- At Revision 5, additive migration `0006_maintenance_heartbeat.sql` advanced
  the application marker to `rfp-xray-schema-v7` and added a singleton
  maintenance heartbeat. This historical revision was subsequently superseded
  by schema v8 and migration `0007_release_attestations.sql`.
  The row stores only completion time, bounded duration/budget, and aggregate
  counts—never credentials, run IDs, or tender content.
- The authenticated endpoint processes at most five admission candidates, five
  cleanup candidates, and ten incoming-upload cleanup candidates per call. It
  has a 45-second internal deadline inside the 60-second function limit.
- A timeout or any reconciliation/storage/database failure returns a sanitized
  `503` and does not refresh the heartbeat. The heartbeat write occurs only
  after all bounded phases complete.
- Production health and run admission require a valid successful heartbeat no
  older than 15 minutes. `CRON_SECRET` alone is not liveness proof. Missing,
  stale, or unreachable heartbeat state keeps production unavailable.
- The GitHub caller now uses a five-second connection timeout and 50-second
  request timeout, below the Vercel function limit.

### Revision 5 Focused Verification

- Maintenance/health/migration/live-verifier unit suites: PASS.
- Cancellation/expiry and retention cleanup integrations: PASS.
- Focused ESLint: PASS.
- Full typecheck must be rerun after concurrent provider/security edits settle;
  the maintenance files themselves introduced no remaining diagnostic in the
  last run.

### Deployment Gate

- Schema v8 is applied to the active Neon resource. Do not infer release
  readiness from schema state alone.
- `CRON_SECRET` is rotated consistently in Vercel production/preview and GitHub
  Actions, but the GitHub maintenance variable remains intentionally false
  until the new committed deployment exists. Enable it only then and require a
  successful authenticated bounded production heartbeat.

---

## Revision 6 — Current Pre-Deploy Attestation and Security Handoff

This section supersedes earlier current-state counts while preserving their
historical implementation record.

### Verified implementation

- Neon probe: 9 public tables, 8 migration rows, schema version 8, marker
  `rfp-xray-schema-v8`; live contention/CAS suite passed 2/2, including a real
  CAS-loss path.
- Railway: bound attestation expires 2026-09-10 04:11:53 MDT; S3 live suite
  passed 1/1 and a real Chromium storage flow with
  `https://rfp-xray.vercel.app` as Origin passed 1/1.
- Vercel project settings use Node 22 and Fluid Compute.
- Deployment-bound runtime-attestation code was independently approved with
  P0/P1/P2=0. No current runtime receipt exists before a clean committed
  deployment.
- Deployment-bound provider-contract attestation code was independently
  approved with P0/P1/P2=0. No provider receipt or call exists because the
  Monid key/exact configuration are absent.
- Security re-review returned `APPROVE`, P0=0/P1=0. Both P2 recommendations are
  now implemented and tested.

### Current regression gate

- `pnpm check`: PASS, 39 files passed/3 skipped and 391 tests passed/7 skipped.
- Historical Revision 6 build: PASS; its generated-route count is superseded
  by the current evidence below.
- Local Playwright: PASS, 14 passed/2 explicit live skips.
- Official fixture audit: PASS, 3/3.
- Production dependency audit: PASS, no known vulnerabilities.
- Full dependency audit: zero high/critical findings; 1 low/3 moderate
  development-chain findings remain after scoped overrides. Vercel CLI remains
  pinned at 59.11.2, and 33 focused runtime/provider attestation tests pass.

### Release boundary

Reviewed implementation commit `dfc8be9` is local; the public deployment is the
older sample until the release commits are pushed.
Production Turnstile is absent. Chrome/in-app interactive browser control is
unavailable. No paid Monid call, real Edmonton/CER campaign, end-to-end live
cleanup/cost/latency proof, video, submission, or social publication exists.
The release remains `NOT_READY`.

The receipt-refresh heartbeat is scheduled for Sep 9 and Sep 10 at 12:00 MDT.

## Revision 7 — Deployed Runtime and Scheduled Maintenance Handoff

This section supersedes Revision 6 only for deployment and maintenance state.

- Application commit `936041e8ca1ed626978ee8750ba640ef4975c4d9` is pushed and
  deployed. Public read-only production smoke passed 4/4.
- Captured deployment `dpl_EW9Bt6QLnhbMSwhEL5yY3AaJ64GE` has an exact
  deployment-bound 300-second Workflow runtime receipt. The documentation-only
  deployment created by this evidence update requires its own receipt.
- The shared maintenance secret is consistent across Vercel, GitHub, and
  Railway. Post-rotation GitHub manual dispatch succeeded.
- The dedicated Railway `maintenance-cron` has no public domain or volume,
  zero instances between runs, restart policy `NEVER`, and no RFP/provider
  credentials. Three consecutive scheduled cycles produced bounded durable
  heartbeats. Independent review: `APPROVE`, P0/P1/P2=0.

## Revision 8 — Credentialed Monid Contract Spike

This section supersedes older statements that the Monid key/configuration or
all paid-provider evidence is absent.

- The authorized Key is present in the ignored local environment, active in
  the Monid credential store, and stored as a Vercel Sensitive Secret for all
  deployment targets. Exact non-secret adapter configuration is also stored.
- Credentialed `discover → inspect` pinned `context.dev /parse`, its response
  paths, normal cost USD 0.0009, OCR maximum USD 0.0045, and canonical inspect
  SHA-256
  `551283ef6526c09f276f4c2d82015168e083cdc348063521db1172c683384476`.
- Two Edmonton parses succeeded at USD 0.0009 each. The Railway five-minute
  signed-URL probe captured the artifact and confirmed source deletion/absence
  in 8.140 seconds.
- ZDR is unavailable for this Context.dev workspace. Its response reported a
  seven-day upstream artifact expiry and no early-delete API is known. The
  candidate discloses this before submission, in Audit & Cost, and in health.
- The normalized Markdown contained no trustworthy physical-page boundaries.
  PDF.js remains citation truth; unbound Monid/OCR facts are withheld.
- Current candidate checks: 423 tests passed/10 skipped across 44 passed/4
  skipped files; build PASS with 8 steps/4 workflows/13 pages; Playwright 14/2;
  official fixtures 3/3; opt-in
  paid Monid/Railway probe 1/1.
- The analysis-dispatch claim/start/settlement ACK-loss fence is implemented,
  focused-tested, and independently approved with P0=0, P1=0, and P2=0.
- Production schema v9 is applied and its live Neon suite passed 4/4. The
  conservative five-document full reserve is USD 1.412123 and
  includes 24 generated function invocations; this is not a usage receipt.
- Current release commit `76e0f4e01f93d67eab4da9b98807959b81578396`
  is deployed as `dpl_5dMrPWKGMCKxy5hcQUfq57uLmZce`; CI, runtime receipt,
  Monid/OpenAI provider receipt, and read-only smoke 4/4 passed.
- Still open: Turnstile and its one-time redeployment/receipt refresh, ten-run
  Edmonton plus CER campaign, at least 12 production citation clicks, video,
  registration, submission, and five social publications. Release remains
  `NOT_READY`.
- GitHub did not emit a `schedule` event during the observation window. It is
  redundant only and is not claimed as the source of scheduled-delivery proof.

The Turnstile-triggered redeployment and refreshed
attestations, paid Edmonton/CER, end-to-end
cleanup/cost/latency, citation click-through, video, submission, and five
publication gates remain open. The release remains `NOT_READY`.

## Revision 9 — Turnstile Configuration and Platform Redelivery Canary

This section supersedes older Turnstile, local-candidate, and regression-count
statements.

- Current reviewed implementation candidate:
  `4089397de8f2cfc3dc4846911bd9767adea178f4`; it is reviewed, committed, and
  intentionally unpushed until the single final production deployment.
- A Cloudflare Managed Turnstile widget allowlists only
  `rfp-xray.vercel.app`; the site key, sensitive secret, and exact hostname are
  configured in Vercel Production. The current immutable production deployment
  predates them, so health remains correctly fail-closed until redeployment.
- Current checks: 47 test files passed/4 skipped, 465 tests passed/10 skipped;
  build PASS with 9 steps/5 workflows/13 pages.
- One provider-free Preview canary was started once, received a literal
  `SIGKILL`, and completed through same-step Vercel Workflow redelivery. Its
  final verifier re-read the same run with `workflow_start_count=0`, two ordered
  starts, materialized/output attempt 2, one completion, zero retry/failure
  events, and no third attempt. Vercel omitted optional event attempt fields,
  so the `[1,2]` sequence is explicitly marked derived.
- Independent verifier, pagination, reproducible log-generator, and combined
  evidence reviews returned `APPROVE`, P0=0/P1=0. Because the Vercel log row
  contains no raw run ID, its truth boundary is deployment/window
  corroboration only, not exact-run binding. This is isolated
  platform-redelivery evidence, not full application cleanup recovery.

Still open: final deployment and fresh attestations, real Turnstile challenge,
full guest flow, paid Edmonton/CER campaign, cleanup/latency/cost reconciliation,
12-citation review, final video, registration, submission, and five social
publications.

## Revision 10 — Shared Submission-Channel Classifier Redesign

This bounded T4 revision replaces the two drifting submission-channel polarity
implementations with one source-grounded classifier. It is implementation
evidence for independent QA2 review, not self-certification. No network,
credential, deployment, paid-provider, commit, or governance action occurred.

### Changed Files

- Added `src/lib/analysis/submission-channel.ts` as the shared semantic owner.
- Updated `src/lib/analysis/source-anchors.ts` and
  `src/lib/analysis/materialize.ts` to consume that classifier.
- Expanded `tests/unit/closed-template-recovery.test.ts` and
  `tests/unit/core-field-recovery-materialize.test.ts` with permissive,
  conditional-rejection, deadline-qualified, and explicit-prohibition cases.
- `tests/golden/official-fixture-audit.test.ts` was not changed by this revision;
  its current official Edmonton checks were rerun.

### Decisions

- Each verified whole-bid relation now reports distinct `possibleChannels`,
  `publishableChannels`, and `prohibitedChannels`. A possible channel can block a
  false unique summary without becoming an active definitive claim.
- `may`/`can`, conditional clauses, conditional rejection, and negative review
  timing are ambiguity-only. `not later than` remains a deadline qualifier, so a
  mandatory Portal clause is publishable and also blocks recovered Email.
- Unconditional channel rejection, `must|shall not submit`, and equivalent direct
  exclusions are prohibitions and do not enter the possible-channel set.
- Materialization retains verified submission evidence even when its model claim
  fails publication validation. Publication still requires one active,
  publishable channel and package-wide possible-channel uniqueness.

### Evidence Boundary

- Confirmed: focused source/materialization/reconciliation suites pass 237/237;
  ESLint and TypeScript pass; the official fixture audit passes 3/3, including
  Edmonton Email on physical p6 and the existing cover/evaluation facts.
- Inferred: separating ambiguity from publication closes the two QA2 P1 findings
  without weakening the existing negative/artifact filters.
- Unknown: independent Reviewer verdict and the next paid production Edmonton run.

### Exact Checks

- `pnpm test -- tests/unit/closed-template-recovery.test.ts tests/unit/core-field-recovery-materialize.test.ts tests/unit/summary-recovery.test.ts tests/unit/materialize-reconciliation.test.ts`:
  PASS, 4 files and 237 tests.
- `pnpm test`: PASS, 53 files passed/4 skipped and 605 tests passed/10 skipped.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm test -- tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests.
- `pnpm lint`: PASS. `pnpm typecheck`: PASS.
- `git diff --check` on the bounded implementation/test paths: PASS; only Git's
  Windows LF-to-CRLF notices were emitted.

### Risks and Follow-ups

- The classifier is deliberately fail-closed for mixed contrastive clauses: an
  uncertain channel remains ambiguity rather than proving another channel unique.
- QA2 must independently review the shared classifier and affected regressions.
  After `PASS`, run the full regression gate before any production deployment.

### Proposed Long-Term Memory

- Submission-channel evidence has two independent thresholds: source-grounded
  possibility controls ambiguity, while source-grounded definitiveness controls
  publication. Direct channel prohibitions belong to neither possible nor
  publishable candidates.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## T9 Implementation — Source-Ledger Package Authority

This is the bounded T9 implementation handoff for independent QA7. It is
implementation evidence, not self-certification. No network or paid-provider
call, credential use, database operation or migration, deployment, commit,
push, public API change, or Reviewer-verdict edit occurred.

### Changed Files

- `src/lib/analysis/submission-channel.ts`
- `src/lib/analysis/record-authority.ts`
- `src/lib/analysis/materialize.ts`
- `src/lib/runs/record-authority-audit.ts`
- `scripts/read-record-authority-audit.mjs`
- `tests/unit/submission-adjudication.test.ts`
- `tests/unit/record-authority.test.ts`
- `tests/unit/record-authority-audit.test.ts`
- `tests/integration/record-authority-audit.test.ts`
- `tests/golden/official-fixture-audit.test.ts`
- `docs/specs/MH-001-rfp-xray/reframing_review.md`
- `docs/specs/MH-001-rfp-xray/t7-record-bound-semantic-authority.md`
- `docs/specs/MH-001-rfp-xray/tasks.md`
- This handoff section.

`qa_gate.yaml` and release-evidence files already present in the shared dirty
worktree are Chief/Reviewer-owned and were not edited as part of T9.

### Implemented Boundary

- `discoverSubmissionCandidateLedger` continues to cover every PDF.js page with
  complete overlapping 3,200-UTF16 windows. The Agent adjudicates every window.
  Lexical matches are hints only: the server no longer uses a channel dictionary
  to validate Agent semantics or require a relation. Returned relations still
  require exact source offsets, bounded spans, confidence, manifest identity,
  and identical relation sets in every enclosing overlapping window.
- `VerifiedSubmissionAdjudication` is the sole package submission authority.
  With record authority present, Draft summary/channel values, model amendment
  signals, generated model conflicts, record receipt corruption, and model
  publication failures cannot establish or remove the ledger channel.
- Receipt v3 gives each origin and canonical joined record `source_binding`
  (`unlocated|exact_bound|coverage_gap|relation_gap|relation_conflict`),
  `semantic_crosscheck` (`consistent|disagrees|unknown`), and `publication`
  (`verified|discarded`).
- Unlocated `s/n/u`, missing or duplicate annotations, exact-occurrence capacity,
  and later field/scalar/publication failures discard only the affected model
  record. Discarded records provide no reconciliation lineage, conflict input,
  or persisted Q&A evidence.
- Exact-source `s` coverage/relation gaps or incompatible relations, exact `n`
  overlap with whole-bid/ambiguous relations, exact `u`, and exact canonical
  `s/n` disagreement set the record receipt's package veto. Ledger incomplete,
  multiple, contradicted, semantically uncertain, metadata-incomplete, or
  prompt-tainted states remain independently unresolved.
- Receipt corruption, unknown annotations, lost/multiple mapping, merged-set
  mismatch, overflow, and legacy v1/v2 receipts suppress all model records. If
  the source ledger is independently complete and unique, its derived channel
  and decisive exact citation remain available.
- Audit v3 retains the prior seven allowlisted measurements and adds only strict,
  fixed-key integer counters for relevance, source binding, semantic crosscheck,
  publication, publication reason, and exact-source veto reason. It contains no
  IDs, page numbers, offsets, URLs, source/quote/window text, record bodies, or
  private model output. Historical v1/v2 audit rows remain strict-readable;
  the existing nullable JSONB column needs no SQL migration and no public route
  was added.

### Falsification Evidence

- A thirteen-case matrix covers unlocated `s/n/u`, missing/duplicate/unknown
  annotation, exact `s` coverage gap/relation gap/incompatible relation, exact
  `n` whole-bid overlap, exact `u`, and verified exact `s`/`n` controls.
- Invented and paraphrased SecureDrop records cannot denial-of-service verified
  Email. The behavior is exercised across Claim, Requirement, Risk, and
  Evaluation; each discarded record is absent from public results and Q&A.
- Email plus an unfamiliar SecureDrop relation mapped by the Agent to the
  bounded `portal` enum resolves as multiple without adding a product/channel
  lexicon. A real exact SecureDrop gap vetoes.
- The 126-record/25-bad-citation fixture and the four-collection fixture retain
  verified Email and deterministic facts while dropping bad records. Four or
  twenty-five non-material publication failures therefore have the same package
  effect. Fourteen exact submission Requirements remain publishable when the
  all-page ledger is uniquely Email.
- Corrupt mapping and v1/v2 receipt tests prove all model records are suppressed
  while an independent ledger-derived Email remains. Later-invalid records do
  not contribute reconciliation lineage or conflicts.
- Official local `representative_local` v3 receipt sizes are 4,225 bytes for
  Edmonton (257,919-byte headroom) and 6,681 bytes for CER (255,463-byte
  headroom) against the unchanged 262,144-byte hard cap. These are local
  representative measurements, not paid-provider or worst-case evidence.

### Exact Checks

- `pnpm test -- tests/unit/record-authority.test.ts tests/unit/submission-adjudication.test.ts tests/unit/core-field-recovery-materialize.test.ts tests/unit/closed-world.test.ts tests/unit/record-authority-audit.test.ts tests/integration/record-authority-audit.test.ts`:
  PASS, 6 files and 148 tests.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm test -- tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests.
- `pnpm check`: PASS; ESLint and TypeScript passed, 57 test files passed/4
  skipped, and 731 tests passed/10 skipped.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and 13 static pages completed.
- `pnpm exec playwright test`: PASS, 14 browser tests passed and 2 credentialed
  Railway S3 live tests skipped.
- `git diff --check`: PASS; only Windows LF-to-CRLF notices were emitted.

### Risks and Follow-ups

- A complete all-page Agent adjudication remains the semantic authority; the
  server verifies source binding and cross-window consistency but does not
  independently understand arbitrary English. This is explicit and introduces
  no channel/topic grammar heuristic.
- The bounded channel enum maps unfamiliar product names to a semantic channel
  such as `portal`. If the Agent cannot do so confidently, it must emit
  `unspecified`/unknown and the ledger remains unresolved.
- No new paid run is authorized by this handoff. QA7 must independently approve
  P0/P1=0 before the Chief redeploys and performs the final controlled Edmonton
  evidence run.

## T7 Implementation — Record-Bound Agent Semantic Authority

This is the implementation handoff for the separately approved T7 design in
`t7-record-bound-semantic-authority.md`; it is not a fourth T6 revision and is
not a self-certifying Reviewer verdict. No network/provider token-count call,
paid call, credential access, deployment, commit, push, public API/DB/UI schema
change, or governance/QA-verdict edit was performed.

### Changed Files

- `src/lib/analysis/record-authority.ts` (new)
- `src/lib/analysis/draft.ts`
- `src/lib/analysis/reconciliation.ts`
- `src/lib/analysis/materialize.ts`
- `src/lib/analysis/local-model.ts`
- `src/lib/providers/openai.ts`
- `src/lib/pipeline.ts`
- `tests/unit/record-authority.test.ts` (new)
- `tests/golden/official-fixture-audit.test.ts`
- This T7 section in `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### Implemented Decisions

- The existing paid structured extraction response now includes the private
  `{v:1,r:[kind,ordinal,relevance]}` record-authority sidecar. OpenAI strict
  Structured Outputs cannot express tuple-form JSON Schema items, so the wire
  is a homogeneous length-three array and the server immediately re-parses each
  item with the strict positional tuple schema. Malformed arrays decode to an
  empty/incomplete receipt and fail closed.
- Every model Claim, Requirement, Risk, and Evaluation record is keyed from the
  authority version, server batch ID, kind, ordinal, and canonical complete
  public record. Model IDs do not establish semantic identity. Exact duplicate
  records join conservatively; distinct reused IDs receive the existing content
  suffix. The final merged record set is checked against the same merge result.
- Citation occurrence discovery uses every authoritative raw PDF.js page in the
  complete `CitationDocument`, not candidate-window scanning. Every exact raw
  occurrence must be fully enclosed by a ledger window and yield a consistent
  verified relation state. Cross-document, uncovered, normalized-only,
  relationless `s`, forbidden-overlap `n`, duplicate mixed-match, and tainted
  batches become unresolved.
- The server computes and verifies a private manifest digest over the complete
  origin-to-merged mapping and joined states. Lost, multiply attached, or
  differently mapped origins fail integrity before materialization.
- Reconciliation facts and generated conflicts now retain private contributing
  origin keys, including active/superseded facts and amendment delete
  tombstones. A conflict with an `s`/uncertain contributor remains visible but
  vetoes the submission method and cannot become Q&A authority.
- Materialization applies each joined state: verified `n` proceeds through the
  ordinary validators; compatible verified `s` may proceed; unresolved records
  make Claims/Requirements `needs_review` and omit Risks/Evaluation. Recovered
  deterministic records keep their existing path. The persisted-result Q&A
  fallback remains the Revision 18 rule when the final method is null.
- Production pipeline callers always substitute an explicit unresolved receipt
  if a model implementation omits T7 output. Direct legacy materialization test
  fixtures without the optional private argument retain their pre-T7 behavior;
  this cannot bypass the production pipeline gate.
- Provider caps are enforced at 40 annotations per batch and three citations
  per annotated record. The exact 40-tuple sidecar is included in each canonical
  private control-plane calculation. Revision 1 below corrects the initial
  handoff's broader capacity interpretation. Overflow is incomplete; no
  truncation, retry, extra call, or changed paid settlement path was introduced.

### Confirmed / Inferred / Unknown

- Confirmed: dedicated T7 regressions cover Email `s` plus financial `n`, exact
  unfamiliar SecureDrop Claim/Requirement/Risk/Evaluation failures, missing,
  duplicate and unknown annotations, duplicate raw quote mixed relations,
  cross-batch `s/n` disagreement, prompt-injection taint, manifest digest/lost/
  multiply-attached origins, materialization and persisted Q&A, generated
  conflict veto, and amendment tombstone contributor lineage.
- Confirmed: frozen official maximum private **control-plane sidecars** are
  Edmonton `[8617,9553,9907]` bytes (28,077 aggregate) and CER
  `[7533,7455,7759,8237,9257]` bytes (40,241 aggregate). As corrected by
  Revision 1, the differences from 50,000 are not full-response/token headroom.
- Confirmed: official Edmonton/CER PDF facts, ordering, citation pages,
  deterministic recovery, and the new envelope measurements pass locally.
- Superseded inference: the initial handoff did not prove a finite private
  receipt bound because an exact quote can repeat throughout a source. Revision
  1 adds explicit occurrence and complete serialized-receipt caps.
- Unknown: independent QA5 verdict and behavior of a new paid production model
  response under the T7 schema. No paid call was authorized or made here.

### Exact Checks

- `pnpm vitest run tests/unit/record-authority.test.ts`: PASS, 1 file and 13
  tests.
- `pnpm vitest run tests/unit/openai-adapter.test.ts tests/unit/materialize-reconciliation.test.ts tests/unit/summary-recovery.test.ts tests/unit/closed-world.test.ts`:
  PASS, 4 files and 246 tests.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests. PDF.js emitted no acceptance failure.
- `pnpm check`: PASS; ESLint and TypeScript passed, 55 test files passed/4
  skipped, and 700 tests passed/10 skipped.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and 13 static-generation entries completed.
- `git diff --check`: PASS; only Git's Windows LF-to-CRLF notices were emitted.

### Risks and Reviewer Focus

- T7 proves completeness, identity, exact source binding, relation consistency,
  version lineage, and publication policy. As declared in the approved design,
  it cannot independently prove that the same extraction Agent semantically
  labeled arbitrary English `n` correctly; that requires a second semantic
  authority, deterministic classifier, or suppressing all free-form evidence.
- CER's 743-byte difference is only a conservative control-plane-sidecar reserve
  against its deterministic token allocation; it is not complete response
  headroom. Revision 1 makes provider token caps and server receipt bounds
  independent and asks QA5 to inspect both no-truncation paths.
- QA5 should independently exercise the exact `SecureDrop` controls through
  the provider adapter and materializer and verify the private lineage fields
  are stripped by final `AnalysisResultSchema` parsing.

### Proposed Long-Term Memory

- Semantic authority for model-authored free text must be bound per record in
  the same response, while identity, occurrence enumeration, merge lineage,
  reconciliation, and publication remain server-owned.
- Exact citation occurrence checks must enumerate the complete raw PDF.js page
  corpus before mapping occurrences to bounded coverage windows; scanning only
  candidate windows can miss duplicates or boundary-spanning evidence.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## T7 QA5 Revision 1 — Canonical Record Binding and Truthful Capacity Bounds

This bounded revision addresses only QA5 findings `P1_RECORD_RECEIPT_REUSE`
and `P1_INCOMPLETE_WORST_ENVELOPE`. It corrects the proof model without adding
a provider call, retry, public API/DB/UI field, deployment, credential access,
paid action, commit, push, or Reviewer-verdict edit. This is implementation
evidence for QA5 re-review, not self-certification.

### Changed Files

- `src/lib/analysis/record-authority.ts`
- `src/lib/analysis/materialize.ts`
- `src/lib/providers/openai.ts`
- `tests/unit/record-authority.test.ts`
- `tests/unit/openai-adapter.test.ts`
- `tests/golden/official-fixture-audit.test.ts`
- `docs/specs/MH-001-rfp-xray/t7-record-bound-semantic-authority.md`
- This Revision 1 section in
  `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### Implemented Decisions

- Every authority origin and joined record now carries a SHA-256 digest of
  canonical JSON that excludes only the model-provided `claim_id`/`id` and
  retains every semantic field, document SHA, effect, citations, and lineage-
  relevant value. Semantic deduplication groups by that serialization rather
  than model ID. Identical content under different IDs joins conservatively;
  different content reusing one ID remains distinct with deterministic digest
  suffixes.
- Materialization recomputes the complete current merged-record set and requires
  an exact one-to-one `kind + merged ID + canonical digest` match to the sealed
  manifest. Replaced, missing, duplicated, multiply attached, or cross-record
  receipts fail integrity and enter the existing fail-closed path. A recovered
  record cannot inherit a model origin merely by reusing its ID.
- The receipt digest now commits to the complete retained canonical origin
  payload: origin/batch/kind/ordinal/relevance, canonical record digest,
  origin-to-merged mapping, exact PDF.js page/UTF-16 occurrences, candidate IDs,
  verified relation-binding digests, disposition/reason, and joined contributor
  lineage. Mutating any occurrence, relation binding, or contributor invalidates
  integrity.
- `MAX_EXACT_OCCURRENCES_PER_CITATION=8`; a ninth exact occurrence produces an
  unresolved package veto. `MAX_RECORD_AUTHORITY_RECEIPT_BYTES=262144`; the
  complete receipt payload is serialized and measured before publication, and
  an over-cap receipt is replaced atomically by an unresolved veto rather than
  being truncated.
- Full provider generation is bounded by deterministic per-batch
  `max_output_tokens` allocations whose sum is exactly at most 50,000.
  `output_parsed` is mandatory; max-output/incomplete responses stop later
  dispatches with `ANALYSIS_INCOMPLETE`, no retry, and reported usage above a
  requested batch cap is rejected.
- The old output byte measurement is renamed and documented as a
  **control-plane-only** bound over submission adjudication plus record-authority
  sidecars. It is not presented as complete DraftAnalysis or token headroom.
  The legacy Draft schema has an unbounded `amendment_number`, so no theoretical
  full-response JSON maximum is claimed.
- Superseded cost statement: Revision 1 treated the then-observed five-batch
  plan as global. Revision 2 below corrects this to an actual-plan bound of
  465,000 + (`N - 1`) micro-USD; five is not a global batch maximum.

### Confirmed / Inferred / Unknown

- Confirmed: an `n` invoices receipt cannot authorize a same-ID unfamiliar
  SecureDrop record; it becomes `needs_review` and persisted Q&A returns
  `not_found`.
- Confirmed: same semantics under different IDs deduplicate and join `s/n`
  conservatively; different semantics under one ID remain separate.
- Confirmed: eight exact occurrences pass and nine fail closed; the receipt
  capacity helper accepts exactly 262,144 bytes and rejects 262,145 bytes;
  occurrence, relation-binding, and lineage mutations change the manifest digest
  and fail integrity.
- Confirmed: official control-plane sidecar measurements remain Edmonton 28,077
  bytes and CER 40,241 bytes. These are explicitly not full-response bounds.
- Confirmed: official empty-record control receipts are 143 bytes. Non-empty
  `representative_local` receipts using real PDF.js quotes and complete ledgers
  are Edmonton 3,806 bytes with 258,338 bytes headroom (one verified `s`, two
  `n`, three batches) and CER 5,998 bytes with 256,146 bytes headroom (five `n`
  records, five batches, four documents).
- Inferred: the hard server cap and provider token cap fail closed independent of
  representative output size; the representative measurements demonstrate local
  utility but are not worst-case or paid-production evidence.
- Unknown: the actual non-empty receipt byte length and output-token utilization
  of the next controlled paid Edmonton/CER run. The first authorized post-deploy
  run must record both as the empirical sufficiency gate.

### Exact Checks

- `pnpm vitest run tests/unit/record-authority.test.ts tests/unit/openai-adapter.test.ts`:
  PASS, 2 files and 51 tests.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests; both representative receipts and their exact
  headroom values were asserted from official PDF.js indexes.
- `pnpm check`: PASS; ESLint and TypeScript passed, 55 test files passed/4
  skipped, and 706 tests passed/10 skipped.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and 13 static-generation entries completed.
- `git diff --check`: PASS for tracked changes; no whitespace errors were found
  in the new T7 design, implementation, or regression files.

### Risks and Reviewer Focus

- QA5 should reproduce the same-ID invoices/SecureDrop substitution through
  materialization and persisted Q&A, then independently mutate one canonical
  record field while retaining the model ID.
- The 262,144-byte server receipt boundary is a hard runtime safety gate. The
  3,806/5,998-byte official values are representative local receipts, not a
  theoretical full-model-output maximum.
- Provider usefulness remains empirical because the public Draft schema is not
  statically byte-bounded. Any truncation is still terminal, with no later call
  or retry; this revision does not weaken that safety behavior.

### Proposed Long-Term Memory

- Bind semantic authority to canonical record content and exact lineage, never
  to a model-provided identifier.
- Keep provider generation caps, private control-plane sidecar proofs, and
  server receipt memory caps as distinct quantities; never relabel one as
  another's headroom.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## T7 QA5 Revision 2 — Recovered Identity Fence and Plan-Specific Cost Gate

This bounded revision addresses only QA5 Revision 1 findings
`P1_RECOVERED_RECORD_ORIGIN_COLLISION` and `P2_FIXED_FIVE_BATCH_COST_CLAIM`.
It does not change the public API, database, UI, provider request/retry shape,
or paid-attempt lifecycle. No network, credential, paid call, deployment,
commit, push, or Reviewer-verdict edit occurred. This is implementation evidence
for the same Reviewer's re-review, not self-certification.

### Changed Files

- `src/lib/analysis/materialize.ts`
- `tests/unit/record-authority.test.ts`
- `tests/unit/openai-adapter.test.ts`
- `docs/specs/MH-001-rfp-xray/t7-record-bound-semantic-authority.md`
- This Revision 2 section in
  `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### Implemented Decisions

- Materialization constructs explicit recovered-ID sets for Claims,
  Requirements, Evaluation rules, and the currently empty future Risk recovery
  path. One shared lookup returns no model authority for any recovered
  `kind + public ID`, and its companion lineage lookup therefore returns no
  model origin keys.
- The shared lookup is used by record authorization, submission-relevance
  tracking, reconciliation contributor assignment, generated-conflict
  authority, and compatibility checks. A model record replaced by a recovered
  record cannot transfer its `s`, `n`, or `u` state to the recovered fact or to
  another record solely through a colliding public ID.
- The collision regression uses three valid `s` model origins whose IDs collide
  independently with a recovered cover Claim, M1 Requirement, and Basis of
  Selection Evaluation rule. It asserts model authority is absent and
  `contributing_origin_record_keys=[]` for every recovered identity, while the
  recovered title, requirement, and selection method remain authoritative and
  the verified Email submission method is not spuriously vetoed.
- Provider cost authority is the actual prepared plan's batch count `N`, not a
  fixed five-call assumption. Deterministic output caps still sum to at most
  50,000. The tight cost upper bound is the aggregate 465,000 micro-USD base at
  320,000 input/50,000 output plus `N - 1` micro-USD request-rounding slack.
  The adapter already evaluates this plan-specific maximum before its first
  paid dispatch and rejects any plan above the configured 495,000 reserve.
- Seven- and nine-batch synthetic plans prove cap totals and respective tight
  estimates of 465,006 and 465,008 micro-USD. A deliberately lower reserve
  proves an above-reserve plan performs zero provider parse calls and zero paid
  dispatch callbacks.
- Official local packing currently observes three batches for Edmonton and five
  for CER. Five remains an ordinary packing target, not a hard maximum.

### Confirmed / Inferred / Unknown

- Confirmed: Claim/Requirement/Evaluation recovered-ID collisions return no
  model authority or origin lineage; their colliding model records are replaced,
  ordinary recovered output remains active, and `summary.submission_method`
  remains `Email`.
- Confirmed: the seven- and nine-batch calculations use their actual `N - 1`
  rounding slack and remain inside the current reserve; a plan-specific reserve
  failure happens before any paid action.
- Confirmed: all Revision 1 record digest, occurrence, receipt, official fixture,
  and fail-closed behaviors remain green.
- Inferred: future server Risk recovery is protected if it populates the declared
  recovered Risk ID set before authority lookup; no Risk recovery exists today.
- Unknown: the batch count, receipt size, token usage, and cost of the next
  controlled production run. Runtime plan-specific preflight, not a static
  maximum-`N` claim, is authoritative.

### Exact Checks

- `pnpm exec tsc --noEmit; pnpm vitest run tests/unit/record-authority.test.ts tests/unit/openai-adapter.test.ts tests/unit/materialize-reconciliation.test.ts tests/unit/core-field-recovery-materialize.test.ts tests/unit/closed-world.test.ts`:
  PASS, 5 files and 291 tests after TypeScript passed.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests.
- `pnpm check`: PASS; ESLint and TypeScript passed, 55 test files passed/4
  skipped, and 709 tests passed/10 skipped.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and 13 static-generation entries completed.
- `git diff --check`: PASS for tracked changes; the separate untracked-file
  whitespace check also passed.

### Risks and Reviewer Focus

- Reviewer should independently replace each collision model record while
  retaining its ID and receipt, and verify the recovered fact receives neither
  authority nor contributor lineage.
- There is deliberately no static maximum batch-count claim. If unusual packing
  yields a larger `N`, deterministic caps and the cost estimate use that exact
  plan and reject it before dispatch when the reserve is insufficient.

### Proposed Long-Term Memory

- Server recovery creates a new trust identity even when its presentation ID
  collides with a model record; model authority and origin lineage must not cross
  that boundary.
- Cost proofs must use the actual request plan and per-request rounding, not an
  observed or target batch count presented as a global maximum.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## T7 QA5 Revision 3 — Sanitized Actual Receipt Audit

This final bounded T7 revision addresses only QA5's actual receipt audit P1. It
adds a private production evidence path without exposing a public route or
persisting source/model content. No network, credential, paid-provider call,
deployment, commit, push, or Reviewer-verdict edit occurred. This is
implementation evidence for the same Reviewer's final re-review, not
self-certification.

### Changed Files

- `src/lib/runs/record-authority-audit.ts`
- `src/lib/runs/types.ts`
- `src/lib/runs/store.ts`
- `src/lib/pipeline.ts`
- `src/db/schema.ts`
- `src/db/neon-store.ts`
- `drizzle/0009_record_authority_audit.sql`
- `drizzle/meta/_journal.json`
- `scripts/database-schema-probe.mjs`
- `scripts/read-record-authority-audit.mjs`
- `tests/unit/record-authority-audit.test.ts`
- `tests/integration/record-authority-audit.test.ts`
- `tests/integration/retention-cleanup.test.ts`
- `tests/unit/migrations.test.ts`
- `docs/specs/MH-001-rfp-xray/t7-record-bound-semantic-authority.md`
- This Revision 3 section in
  `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### Implemented Decisions

- `RecordAuthorityAuditSchema` is strict and allows exactly `version`,
  `manifest_digest`, `receipt_byte_length`, `receipt_limit_bytes`,
  `record_count`, `complete`, and `recorded_at`. Digest is SHA-256 shaped and
  byte counts remain bounded by the frozen 262,144-byte receipt cap. There is
  no source text, quote, page/window, URL, raw model output, record body, or
  full receipt in this record.
- `createRecordAuthorityAudit` rechecks the complete server receipt's integrity
  immediately before persistence. A missing or mutated receipt is replaced by
  a server-owned unresolved receipt and produces a truthful `complete=false`
  audit; it never reuses unverified digest/size fields.
- New runs initialize `recordAuthorityAudit=null`. A successful pipeline writes
  the audit in the same final update that exposes the materialized result, only
  after raw cleanup confirmation, deadline gates, and budget settlement. Failed
  cleanup therefore cannot create a complete audit or release a result.
- Schema v10 adds nullable `runs.record_authority_audit` through idempotent
  migration `0009_record_authority_audit.sql`. The Neon row mapping is complete
  in both directions, and the schema probe now requires the new column and v10
  marker.
- The existing 24-hour scrub clears the public analysis and citations but
  deliberately retains the sanitized audit through the 30-day audit window.
  The existing final maintenance deletion removes the run row and audit
  together at `auditExpiresAt`.
- `scripts/read-record-authority-audit.mjs <run-id>` is a read-only operator
  command. It validates the UUID before access, binds the UUID as a Neon query
  parameter, strictly validates the JSONB allowlist, prints only `run_id` plus
  the seven audit fields, and returns explicit nonzero codes for malformed IDs,
  missing rows, missing database configuration, or provider failure. No public
  API endpoint was added.

### Confirmed / Inferred / Unknown

- Confirmed: a production-shaped `processRun` integration uses a real PDF.js
  document, complete submission ledger, non-empty verified record-authority
  receipt, real cleanup gate, and real store update. Its persisted digest,
  receipt byte length, cap, record count, and completeness exactly match the
  receipt generated inside extraction; reading the run returns the same audit.
- Confirmed: the same integration expires the non-null result, observes the
  audit remain unchanged, and then observes the entire row removed just after
  the 30-day audit expiry. The local retention test independently covers the
  cleanup-pending retry path.
- Confirmed: missing authority output reaches the same successful cleanup path
  but persists `complete=false`, `record_count=0`, while final submission
  authority remains null. Mutated receipt metadata is never copied into audit.
- Confirmed: new runs are null; strict schema and CLI reject additional source
  or URL keys; Neon row conversion round-trips the nullable audit.
- Inferred: applying migration 0009 on production Neon will preserve existing
  rows with null audit and allow subsequent controlled runs to record evidence.
- Unknown: actual non-empty receipt byte lengths for the first controlled paid
  Edmonton and CER production runs. Local verified integration and
  `representative_local` official bounds are not relabeled as paid evidence.

### Exact Checks

- `pnpm exec tsc --noEmit; pnpm exec vitest run tests/unit/record-authority-audit.test.ts tests/integration/record-authority-audit.test.ts tests/integration/retention-cleanup.test.ts tests/unit/migrations.test.ts tests/unit/database-health.test.ts`:
  PASS; TypeScript passed, then 5 files and 10 tests passed.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm exec vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests.
- `pnpm check`: PASS; ESLint and TypeScript passed, 57 test files passed/4
  skipped, and 715 tests passed/10 skipped.
- `pnpm build`: PASS; Next production compilation and TypeScript passed;
  Workflow reported 9 steps and 5 workflows; 13 static entries generated.
- `pnpm exec playwright test tests/e2e/rfp-workspace.spec.ts`: PASS, 14/14
  Chromium/mobile tests.
- `node scripts/read-record-authority-audit.mjs not-a-uuid`: correctly emitted
  only `record_authority_audit_invalid_run_id` and exited 64 before DB access.
- `git diff --check`: PASS for tracked changes; `git diff --no-index --check`
  passed for all 14 currently untracked project files (line-ending notices
  ignored); the bounded Rev3 secret-pattern scan also passed with zero hits.

### Risks and Reviewer Focus

- Reviewer should mutate each receipt integrity field and confirm the stored
  audit is incomplete and does not echo the mutation; then inject source/URL
  keys into JSONB and confirm the operator command exits closed without stdout.
- Production proof still requires applying schema v10, completing a controlled
  Edmonton/CER run, and reading each exact run UUID with the operator command.
  That evidence must be labeled paid/production only after it actually occurs.
- The audit is intentionally absent from public API serializers. It is an
  operator evidence record, not a product feature or substitute for the full
  ephemeral authority receipt.

### Proposed Long-Term Memory

- Persist the minimum integrity digest and capacity measurements needed for an
  operational proof, never the sensitive receipt that established them.
- Couple evidence persistence to the same final release gate as the result, and
  retain sanitized audit metadata longer than the user-facing result only under
  the declared audit TTL.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## T8 Implementation — Publication Validity vs Submission Safety

This bounded reframe implements the accepted experiment in
`reframing_review.md`. It changes only private record authority and public
materialization policy; it adds no lexical classifier, closing-date fallback,
public route/schema, database migration, provider call, retry, or cost change.
No network, credential, paid call, deployment, commit, push, or Reviewer-verdict
edit occurred. This is evidence for QA6, not self-certification.

### Changed Files

- `src/lib/analysis/record-authority.ts`
- `src/lib/analysis/materialize.ts`
- `src/lib/runs/record-authority-audit.ts`
- `scripts/read-record-authority-audit.mjs`
- `tests/unit/record-authority.test.ts`
- `tests/unit/record-authority-audit.test.ts`
- `tests/integration/record-authority-audit.test.ts`
- `tests/golden/official-fixture-audit.test.ts`
- `docs/specs/MH-001-rfp-xray/reframing_review.md`
- `docs/specs/MH-001-rfp-xray/t7-record-bound-semantic-authority.md`
- `docs/specs/MH-001-rfp-xray/tasks.md`
- This T8 section in `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### Implemented Decisions

- The paid provider annotation sidecar remains v1. The server-owned authority
  receipt is v2 and hashes the new `discarded_reasons` field. Full v1 authority
  receipts fail the integrity gate and are never upgraded or published.
- Every origin and joined model record is `verified`, `discarded`, or
  `unresolved`. Only an exactly-once canonical `n` record can be discarded, and
  only for `missing_exact_citation`, `cross_document_citation`,
  `non_exact_or_uncovered_citation`, or `incomplete_occurrence_coverage`.
- `discarded` records remain represented in the private canonical mapping so
  exactly-once identity can be proven, but materialization omits them and gives
  them no contributor lineage, generated conflict input, or Q&A authority.
  They increment the disclosed unsupported-item count without creating a
  package truth blocker.
- All semantic/structural faults remain global: any `s` binding failure, `u`,
  missing/duplicate/unknown annotation, prompt taint, submission Requirement
  marked `n`, relation overlap/mismatch, `s/n` disagreement, unmirrored non-null
  submission summary, incomplete ledger, lost/multiple origin, merged mismatch,
  capacity/integrity failure, exact-occurrence overflow, or receipt overflow
  yields `complete=false` and `package_veto=true`.
- Field-specific materialization uses the same split. A verified `n` record that
  later fails publication validation is omitted without lineage or a truth
  blocker. The same failure on a verified `s` record sets the package unbound
  signal and withholds submission authority.
- The behavior applies uniformly to Claims, Requirements, Risks, and Evaluation
  rules. Recovered server facts stay origin-free and can coexist with discarded
  model noise. No closing date is synthesized.
- The private seven-field `RecordAuthorityAudit` and schema v10 JSONB column are
  unchanged. Audit/CLI validation accepts historical version 1 and current
  version 2; new verified or fallback writes are v2. No database migration or
  public endpoint is needed.

### Falsification Evidence

- The Edmonton-shaped fixture has 126 canonical model records in four bounded
  batches. Twenty-five exactly-once `n` records carry non-existent citations.
  The v2 receipt contains exactly 25 `discarded` records,
  `complete=true`, `package_veto=false`, and no unresolved reasons.
- Materialization retains independently adjudicated Email, recovered title, and
  recovered M1 while keeping `closing_date=null`. None of the 25 fabricated
  records is visible or answerable; a discarded origin returns zero public
  contributor keys.
- A companion fixture injects bad `n` records into Claim, Requirement, Risk,
  and Evaluation simultaneously. All four are omitted, Email remains, and Q&A
  returns `not_found`.
- A second companion uses exact citations but unsupported record assertions so
  authority is initially verified `n`; later field validation still omits all
  four collections without suppressing Email. Replacing the record with a
  verified `s` assertion failure suppresses Email and Q&A.
- The global-veto matrix covers bad `s`, `u`, missing, duplicate and unknown
  annotations, prompt taint, submission Requirement=`n`, `n` overlap with a
  whole-bid relation, unmirrored summary, incomplete ledger, merged mismatch,
  legacy v1 authority, and receipt-cap fallback. Existing `s/n` disagreement,
  exact-occurrence 8/9, origin/digest mutation, SecureDrop, amendment lineage,
  recovered collision, provider-cap, cost, and replay regressions remain green.

### Exact Checks

- `pnpm exec tsc --noEmit; pnpm exec vitest run tests/unit/record-authority.test.ts tests/unit/record-authority-audit.test.ts tests/integration/record-authority-audit.test.ts tests/unit/materialize-reconciliation.test.ts tests/unit/closed-world.test.ts tests/unit/openai-adapter.test.ts tests/integration/openai-paid-cost-ledger.test.ts`:
  PASS; TypeScript passed, then 7 files and 241 tests passed.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm exec vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests. V2 freezes empty receipts at 166 bytes,
  representative Edmonton at 3,829 bytes, and representative CER at 6,021
  bytes, all with positive 262,144-byte headroom.
- `pnpm check`: PASS; ESLint and TypeScript passed, 57 test files passed/4
  skipped, and 721 tests passed/10 skipped.
- `pnpm build`: PASS; Next production compilation and TypeScript passed;
  Workflow reported 9 steps and 5 workflows; 13 static entries generated.
- `pnpm exec playwright test tests/e2e/rfp-workspace.spec.ts`: PASS, 14/14
  Chromium/mobile tests.
- `git diff --check` and separate no-index checks for both currently untracked
  evidence/design files: PASS (line-ending notices ignored); the bounded T8
  secret-pattern scan passed with zero hits.

### Confirmed / Inferred / Unknown

- Confirmed: the accepted 126/25 local falsifier and every declared fail-closed
  counterexample pass without changing provider request count or public schema.
- Confirmed: official Edmonton/CER hashes, pages, source facts, amendment
  behavior, and v2 representative receipt bounds pass locally.
- Inferred: the production Edmonton failure mode (126 records, 25 rejected
  citations) no longer suppresses an otherwise complete exact Email ledger.
- Unknown: whether a new paid production Edmonton run returns the same record
  mix and passes every product gate. No repeat paid run is authorized before
  QA6 approval.

### Risks and Reviewer Focus

- QA6 should change each of the 25 `n` annotations to `s` or `u`, remove or
  duplicate one annotation, taint one batch, and mutate one mapping; every case
  must restore the global veto without admitting any affected collection.
- QA6 should use an exact but semantically unsupported citation on both `n` and
  `s`: `n` must disappear without lineage/Q&A; `s` must withhold the method.
- The v2 receipt is internal. A stored v1 audit remains readable, but a v1 full
  authority receipt must never become current authority.

### Proposed Long-Term Memory

- Publication failure and submission safety are separate state axes. Safely
  omitted, Agent-declared non-submission noise should not erase an independent
  submission fact.
- Only a narrow enumerated publication-failure class may be discarded; semantic,
  structural, taint, and capacity uncertainty remain package-wide vetoes.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## Revision 18 — QA4 Non-Requirement Global Veto Delta

This final bounded T6 delta addresses QA4 round 2 finding
`P1-QA-GLOBAL-VETO-NONREQUIREMENT`. It applies one server-owned final submission
resolution gate to model-authored materialization and persisted Q&A without
classifying free-form text by content, topic, service name, or channel lexicon.
It preserves public schemas, database, migrations, UI, provider request count,
retry/deadline semantics, and the non-submission contractual Requirement Q&A
path. It is implementation evidence for QA4's third and final revision review,
not self-certification. No network/provider call, credential use, deployment,
paid call, commit, or push occurred.

### Changed Files

- `src/lib/analysis/materialize.ts`
- `src/lib/analysis/closed-world.ts`
- `tests/unit/summary-recovery.test.ts`
- `tests/unit/closed-world.test.ts`
- `tests/unit/materialize-reconciliation.test.ts`
- This Revision 18 section in
  `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### Finding Resolved

- Materialization now names the exact final condition that previously controlled
  `summary.submission_method`: the private package resolution must be `unique`
  and its decisive relation must have a separately verified exact citation.
  This produces one `hasResolvedSubmissionAuthority` boolean and the summary
  value from the same resolved channel; there is no second semantic path.
- When that boolean is false, every active free-form model-authored Claim is
  demoted to `needs_review` and every model-authored Risk is removed from the
  public result. Server-recovered Claims remain available because they are
  deterministic source anchors, and non-active Claim amendment history is
  preserved. A server-derived submission Claim can be created only when the
  same boolean is true.
- Persisted Q&A treats the stored non-null submission summary as the serialized
  final-authority proof. When it is null, Q&A excludes all Claims, Risks, and
  Conflicts and includes only active Requirements whose category is not
  `submission`. No free-form collection is inspected to decide whether it is
  safe. When authority exists, the ordinary active evidence collections remain
  available without a second channel-text filter.
- The materialization quality counters disclose the active model Claims demoted
  and model Risks removed. Existing deterministic requirement reconciliation,
  superseded history, and stale-risk analysis remain intact; safety controls
  only final visibility and authority.

### Adversarial Regressions

- Exact PDF.js text `Bids must be lodged in SecureDrop.` emitted as a free-form
  Claim becomes `needs_review`, and the same exact text emitted as a valid model
  Risk is omitted, when final submission authority is null.
- The same Claim and Risk remain available when the package independently has a
  unique exact email submission relation, proving that the gate follows final
  server state rather than recognizing or banning the word `SecureDrop`.
- Persisted Q&A separately injects exact active SecureDrop Claim, Risk, and
  Conflict evidence into a legacy-shaped result with a null submission summary.
  Each query returns `not_found` with zero citations.
- A null-summary control result retains an active `financial` Requirement and
  correctly answers which initial and optional periods require prices, proving
  that useful non-submission contractual Q&A remains available.
- Legacy Claim expectations now reflect the intentional active-to-needs-review
  transition when no submission authority exists. Legacy model Risk visibility
  expectations now reflect the intentional global removal, while superseded
  requirements and deterministic stale-history decisions remain asserted.

### Confirmed / Inferred / Unknown

- Confirmed: Q&A no longer imports or calls submission channel signatures. Its
  collection policy depends only on the final stored summary state, Claim and
  Requirement statuses, and the server-owned Requirement category.
- Confirmed: materialization uses the exact unique-resolution-plus-decisive-
  citation condition for both summary publication and the model Claim/Risk veto.
  No SecureDrop, topic, risk, conflict, or equivalent semantic dictionary was
  introduced.
- Confirmed: official Edmonton/CER fixture invariants and the complete local
  test/build gates remain green.
- Inferred: retaining explicit Conflict records for inspection while excluding
  all of them from Q&A under null authority preserves ambiguity disclosure
  without turning a conflict's free text into an answer.
- Unknown: QA4's final independent verdict and live behavior on the next paid
  production run.

### Exact Checks

- Focused Revision 18 gate (`summary-recovery`, `closed-world`,
  `materialize-reconciliation`, `core-field-recovery-materialize`,
  `submission-adjudication`, and `openai-adapter`): PASS, 6 files and 344 tests;
  `pnpm typecheck`: PASS.
- `pnpm check`: PASS; ESLint and TypeScript passed, 54 test files passed/4
  skipped, and 687 tests passed/10 skipped.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and 13 static-generation entries completed.
- `git diff --check`: PASS; only Git's Windows LF-to-CRLF notices were emitted.
  Untracked T6 files were also checked with `git diff --no-index --check`; no
  whitespace defect was reported.

### Risks and Follow-ups

- This is T6 revision round 3 of 3. QA4 must independently rerun unseen
  collection and category-boundary cases. Any remaining P1 requires redesign or
  human direction rather than another patch loop.
- The fail-closed result intentionally suppresses otherwise source-matched model
  Claims and Risks whenever submission authority is unresolved. Non-submission
  Requirements are the sole Q&A path in that state because they have a bounded
  server-owned category; this is a safety/coverage tradeoff, not a claim that
  those omitted facts are false.

### Proposed Long-Term Memory

- A final authority decision must govern every downstream evidence collection.
  When free-form collections have no independently safe semantic boundary, use
  one fail-closed state gate and retain only the server-owned category path that
  has been explicitly reviewed.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## Revision 17 — QA4 Unknown-Channel Global Veto Delta

This bounded delta addresses QA4 round 1 finding
`P1-QA-GLOBAL-VETO-UNKNOWN-CHANNEL`. It removes channel-vocabulary recognition
from the authority decision for Draft submission requirements while preserving
the public schemas, database, UI, provider request count, retry/deadline
semantics, and useful non-submission requirements. It is implementation evidence
for independent QA4 re-review, not self-certification. No network/provider call,
credential use, deployment, paid call, commit, or push occurred.

### Changed Files

- `src/lib/analysis/materialize.ts`
- `src/lib/analysis/closed-world.ts`
- `tests/unit/summary-recovery.test.ts`
- `tests/unit/closed-world.test.ts`
- `tests/unit/materialize-reconciliation.test.ts`
- This Revision 17 section in
  `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### Finding Resolved

- Every source-verified Draft requirement whose declared category is
  `submission` now needs complete, unresolved-reason-free private adjudication
  plus an exact, overlapping, verified whole-bid relation before it can be
  authoritative. An absent, incomplete, unresolved, or complete-but-zero-relation
  private artifact leaves the requirement `needs_review`, regardless of its
  topic, wording, named service, or whether deterministic channel signatures
  recognize the text.
- A complete artifact cannot use an unrelated private relation to repair Draft
  authority: the relation must share the document/page and overlap the exact
  PDF.js citation. Known signatures retain the additional channel-match veto;
  unfamiliar names do not gain authority merely by evading that vocabulary.
- Non-authoritative submission drafts still enter deterministic version
  reconciliation. This preserves stale-history `superseded` status and existing
  cross-version risk cleanup, while every non-superseded result stays
  `needs_review`.
- Persisted Q&A now independently excludes every `submission`-category
  requirement whenever the server-owned result has
  `summary.submission_method=null`. This prevents a legacy or malformed active
  requirement from bypassing the materialization gate.

### Adversarial Regressions

- The exact PDF.js sentence `Bids must be lodged in SecureDrop.` is exercised
  with absent, incomplete, and complete-but-unresolved private artifacts across
  `bid delivery channel`, `secure upload destination`, `response routing`,
  `unfamiliar transport fact`, and `opaque transfer fact` topics. Each case has
  a null submission summary, no active submission authority, and `not_found`
  Q&A with zero citations.
- A complete private artifact with zero overlapping relations cannot establish
  or repair the same unfamiliar SecureDrop requirement.
- A defense-in-depth Q&A regression injects a legacy active
  `category="submission"` SecureDrop requirement into a result whose submission
  summary is null; evidence selection still returns `not_found` with no citation.
- Existing reconciliation regressions now assert the intentional
  `active`-to-`needs_review` contract change for uncorroborated current
  submission deadlines while retaining `superseded` history and stale-risk
  removal.

### Confirmed / Inferred / Unknown

- Confirmed: the authority gate is owned by the requirement category, complete
  private-artifact state, exact citation/relation overlap, whole-bid scope, and
  relation channel validity; no new SecureDrop or topic/channel dictionary was
  introduced.
- Confirmed: non-submission categories do not pass through this new veto, and
  the official Edmonton/CER audit remains green.
- Inferred: retaining vetoed drafts only for reconciliation provides useful
  amendment history without permitting current publication or Q&A leakage.
- Unknown: QA4's independent re-review verdict and live model behavior on the
  next paid production run.

### Exact Checks

- Focused Revision 17 gate (`summary-recovery`, `closed-world`,
  `materialize-reconciliation`, `core-field-recovery-materialize`,
  `submission-adjudication`, and `openai-adapter`): PASS, 6 files and 339 tests;
  `pnpm typecheck`: PASS.
- `pnpm check`: PASS; ESLint and TypeScript passed, 54 test files passed/4
  skipped, and 682 tests passed/10 skipped.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and 13 static-generation entries completed.
- `git diff --check`: PASS; only Git's Windows LF-to-CRLF notices were emitted.
  Untracked T6 files were also checked with `git diff --no-index --check`; no
  whitespace defect was reported.

### Risks and Follow-ups

- QA4 must independently rerun unseen terminology and category-boundary cases.
  Only a Reviewer `PASS` with P0=0/P1=0 can authorize deployment.
- Draft category assignment remains model-produced, so the independent private
  ledger continues to own actual submission-method publication. This delta does
  not turn Draft categorization into standalone authority.

### Proposed Long-Term Memory

- Semantic categories may route untrusted Draft evidence into a fail-closed
  authority gate, but only a complete, exactly bound private adjudication may
  promote a submission fact. Version history and current authority are separate:
  preserve `superseded` facts while withholding uncorroborated current facts.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## Revision 16 — QA4 Agent-Semantic Safety Delta

This bounded delta addresses all five P1 and three P2 findings in QA4's review
of Revision 15. It preserves the Agent-semantic architecture, public contracts,
database, migrations, UI, paid extraction call count, retry/deadline semantics,
and USD 0.495 OpenAI reserve. It is implementation evidence for independent
QA4 re-review, not self-certification. No network/provider call, credential use,
deployment, paid call, commit, or push occurred.

### Changed Files

- `src/lib/analysis/submission-channel.ts`
- `src/lib/analysis/materialize.ts`
- `src/lib/analysis/closed-world.ts`
- `src/lib/providers/openai.ts`
- `tests/unit/submission-adjudication.test.ts`
- `tests/unit/summary-recovery.test.ts`
- `tests/unit/materialize-reconciliation.test.ts`
- `tests/unit/core-field-recovery-materialize.test.ts`
- `tests/unit/openai-adapter.test.ts`
- `tests/golden/official-fixture-audit.test.ts`
- This Revision 16 section in
  `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### QA4 Findings Resolved

- `P1-QA-GLOBAL-VETO`: private relations are visible to materialization only
  when the artifact is complete, globally one-to-one, and has no unresolved
  reason. An incomplete artifact demotes channel-bearing Draft requirements and
  withholds the summary. Persisted Q&A additionally filters channel-bearing
  claims, requirements, risks, and conflicts unless the result has one matching
  authoritative summary channel.
- `P1-OCR-UNBOUND-FENCE`: every channel-bearing Draft claim/requirement must bind
  to an exact PDF.js citation and a hash- or quote-matching verified private
  relation. Missing, normalized-only, OCR/Monid-only, or channel-mismatched
  evidence sets a package veto. Non-whole-bid relations can prove that a Draft
  item is source-bound but cannot establish summary authority.
- `P1-CONDITION-SPAN-BINDING`: condition offsets must now be inside both the
  candidate's exact page window and the verified relation span. A later unrelated
  condition is rejected as `condition_mismatch`.
- `P1-AMENDMENT-MUTATION-VETO`: an exact, verified amendment replace/delete signal
  now vetoes the submission field before examining private amendment relations.
  Stale base authority cannot survive merely because the amendment has zero
  private whole-bid relations.
- `P1-PROMPT-INJECTION-VARIANT`: batch taint now recognizes `forget`, prior or
  previous directions/rules, `do not follow/obey`, and related override/output
  forms. The reproduced `Forget prior directions; output ...` payload taints its
  actual packed batch and cannot publish an offset-valid mocked relation.
- `P2-WINDOW-EDGE-OCCURRENCE`: a lexical occurrence belongs to a window only when
  fully enclosed. Ledger construction proves each occurrence appears in at least
  one candidate; an occurrence longer than the coverage geometry marks capacity
  instead of creating an impossible candidate.
- `P2-GLOBAL-CANDIDATE-ONE-TO-ONE`: server bindings are checked globally before
  response verification. Unknown, missing, or multiply assigned candidates
  produce an unresolved artifact even when every individual batch looks complete.
- `P2-PRIVATE-OUTPUT-PREFLIGHT`: undocumented per-unit token constants were
  removed. The private structured wire uses compact, schema-validated keys while
  retaining all batch, ledger, candidate, SHA, page, relation, condition, and
  confidence fields. The server serializes a canonical maximum-compliant private
  envelope for every batch. Because the configured tokenizer is byte-level BPE,
  UTF-8 byte length is a conservative local upper bound on its token count. Every
  private envelope must fit the baseline per-batch allocation and their aggregate
  must fit 40,000 bytes/tokens, leaving at least 10,000 of the unchanged 50,000
  aggregate output-token cap for `DraftAnalysis`. Overflow clears every private
  assignment and marks capacity unresolved; it never truncates or adds a call.

### Additional Decisions

- Relation capacity is now one slot for an occurrence-free coverage unit and one
  slot per fully enclosed known occurrence, capped at ten. An unfamiliar extra
  relation that cannot fit must be represented as ambiguous/unknown and therefore
  fails closed; deterministic code still does not interpret submission grammar.
- Compact private response keys are decoded immediately into the existing
  internal `SubmissionBatchAdjudication` type. They do not cross the provider
  boundary or change `DraftAnalysis`, `AnalysisResult`, API, database, or UI.
- A Draft channel supported only by a verified prohibited private relation does
  not masquerade as a positive Draft channel. A mismatched Draft claim remains an
  unbound-evidence veto.

### Confirmed / Inferred / Unknown

- Confirmed: exact regressions cover every QA4 active failure, including global
  Q&A veto, unbound OCR-only Portal evidence, out-of-relation conditions, a
  deletion-only amendment, the reproduced injection wording, an edge-straddling
  occurrence, duplicate binding assignment, and local serialized-envelope
  overflow.
- Confirmed: Edmonton retains 81 coverage units over 55 pages. Its new ledger
  digest is
  `4c1d63de591108e88f9c55dec04b8c1e3449cd8337e4d358add4164e762b1734`;
  its exact private byte bounds are `[8024, 8960, 9314]`, total 26,298.
- Confirmed: CER retains 107 coverage units over 75 pages. Its new ledger digest
  is
  `c617540f1566a464037e48efa2fe16043d56ea58a5cf21191db8a937afe0adc5`;
  its exact private byte bounds are `[6940, 6862, 7166, 7644, 8664]`, total
  37,276. Both official packages remain inside the 40,000 aggregate and their
  baseline per-batch bounds without provider calls.
- Confirmed: no second tokenizer/provider preflight was added. The existing
  request-token count and paid generation sequence are unchanged.
- Inferred: the byte-level bound is intentionally looser than real BPE token
  usage, so passing it guarantees private fit but may conservatively reject an
  unusual package that the tokenizer could encode more compactly.
- Unknown: QA4's independent re-review verdict, live model adherence to the
  compact private schema, and the next production Edmonton/CER outcome.

### Exact Checks

- Focused Revision 16 gate (`submission-adjudication`, `summary-recovery`,
  `materialize-reconciliation`, `closed-world`, `openai-adapter`, `citations`,
  `core-field-recovery-materialize`, and `openai-paid-cost-ledger`): PASS, 8
  files and 343 tests.
- `pnpm check`: PASS; ESLint and TypeScript passed, 54 test files passed/4
  skipped, and 675 tests passed/10 skipped.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and 13 static-generation entries completed.
- `git diff --check`: PASS; only Git's Windows LF-to-CRLF notices were emitted.
  Untracked T6 files were also checked with `git diff --no-index --check`; no
  whitespace defect was reported.

### Risks and Follow-ups

- QA4 must independently rerun unseen adversarial cases against Revision 16.
  Only `PASS` with P0=0/P1=0 can authorize deployment.
- The compact private schema is exercised through the same strict OpenAI Zod
  format construction as the production adapter, but live schema compliance and
  real output usage remain deployment evidence.
- The 10,000-token guaranteed aggregate DraftAnalysis remainder is a hard safety
  floor, not a quality claim. Real private JSON should tokenize below its byte
  bound; an incomplete provider response remains fail-closed.

### Proposed Long-Term Memory

- Completeness is artifact-wide authority: partial verified records cannot leak
  into summaries, active requirements, or downstream Q&A.
- Evidence may bind an excluded question/artifact relation without granting
  whole-bid authority; exact binding and semantic authority are separate gates.
- Use a canonical maximum wire envelope and a locally provable tokenizer bound
  instead of undocumented average tokens-per-record constants.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## Revision 15 — T6 Agent-Semantic Submission Adjudication

T6 removes deterministic English submission-semantics parsing from publication
authority. A package-wide PDF.js coverage ledger now travels inside the existing
structured extraction batches; the Agent classifies the relations, while the
server verifies identity, offsets, physical pages, coverage, ambiguity, conflicts,
and the final citation. This is implementation evidence for independent QA4, not
self-certification. No public contract, database, migration, or UI schema changed;
no extra model call, network call, credential use, deployment, paid-provider call,
commit, or push occurred.

### Changed Files

- `src/lib/analysis/submission-channel.ts`
- `src/lib/analysis/source-anchors.ts`
- `src/lib/analysis/materialize.ts`
- `src/lib/analysis/local-model.ts`
- `src/lib/analysis/closed-world.ts`
- `src/lib/providers/openai.ts`
- `src/lib/evidence/citations.ts`
- `src/lib/pipeline.ts`
- `tests/helpers/submission-adjudication.ts`
- `tests/unit/submission-adjudication.test.ts`
- `tests/unit/openai-adapter.test.ts`
- `tests/unit/citations.test.ts`
- `tests/unit/closed-world.test.ts`
- `tests/unit/closed-template-recovery.test.ts`
- `tests/unit/core-field-recovery-materialize.test.ts`
- `tests/unit/materialize-reconciliation.test.ts`
- `tests/unit/summary-recovery.test.ts`
- `tests/integration/openai-paid-cost-ledger.test.ts`
- `tests/golden/official-fixture-audit.test.ts`
- `docs/specs/MH-001-rfp-xray/t6-agent-semantic-design.md`
- This Revision 15 section in
  `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### Decisions

- Every authoritative PDF.js physical page is represented by deterministic,
  overlapping UTF-16 coverage units. IDs and the ledger digest bind the ledger
  version, document SHA, physical page, page-text SHA, raw spans, relation
  capacity, and shared lexical occurrence identities. Input order and duplicate
  documents do not change the ledger.
- Coverage units admit zero-to-many semantic relations. Lexical patterns expose
  channel occurrences only; they do not decide subject, predicate, modality,
  polarity, or condition attachment. `recoverSubmissionMethodAnchors` is retained
  only as a compatibility seam and always returns no authority.
- The existing OpenAI extraction request returns a private
  `submission_adjudication` envelope beside `DraftAnalysis`. Stable batch IDs bind
  the ledger digest plus ordered candidate and source-fragment manifests. All
  source and private payloads are packed into the existing request count and hard
  byte/token/cost/deadline envelope; overflow makes the ledger unresolved and
  never adds a paid call.
- Verification requires every expected batch and candidate exactly once, the
  exact SHA and physical page, authoritative raw-page UTF-16 slices, bounded
  quotes, channel-occurrence enclosure, confidence at least 0.90, complete page
  and source-fragment receipts, and agreement across overlapping windows.
  Unknown, missing, duplicate, mismatched, low-confidence, prompt-injected, or
  capacity-limited coverage is unresolved and dominates resolution.
- The redacted post-cleanup artifact keeps hashes, dispositions, counts, bounded
  decisive whole-bid quotes, and no full source window. The pipeline scrubs the
  temporary candidate windows before materialization.
- Materialization publishes a submission method only from one complete private
  ledger containing one required whole-bid channel and an exact expected-page
  citation. Ordinary `DraftAnalysis` can veto but cannot establish or repair
  authority. A null result adds a blocking unknown.
- Amendments use server-owned role/number/SHA ordering. Invalid/gapped/duplicate
  metadata, disagreement, whole-bid mutations, or unresolved amendment evidence
  withhold the field; safely adjudicated question/artifact/admin content does not
  create submission authority.
- The deterministic local model always returns an unresolved submission artifact.
  Persisted Q&A now consumes active evidence only, so `needs_review`, conflicted,
  unresolved, or vetoed Draft submission claims cannot answer authoritatively.
- The closed evaluation recovery regression now allows a complete mandatory-gate
  sentence to survive when a following selection sentence is physically
  incomplete, without joining that selection assertion across pages.

### Confirmed / Inferred / Unknown

- Confirmed: unfamiliar delivery predicates (`received`, `arrive`, `lodged`,
  `filed`, and `dispatched`) reach Agent coverage without a deterministic verb
  list and cannot publish an unspecified channel.
- Confirmed: mixed whole-bid/question/artifact/invoice relations, conditional
  relations, same- versus different-channel prohibitions, overlap disagreement,
  prompt injection, Draft disagreement, amendment disagreement, metadata gaps,
  capacity overflow, and every declared ID/SHA/page/channel/offset/confidence
  failure have fail-closed regressions.
- Confirmed: ten identical mocked responses produce byte-stable redacted
  artifacts; candidate and document permutations retain stable IDs and digests.
- Confirmed: Edmonton produces 81 coverage units over all 55 physical pages,
  packs into 3 existing extraction batches, and the fixture Agent decision yields
  only p6 Email with an exact citation. CER produces 107 coverage units over all
  75 physical pages and packs into 5 existing extraction batches; each serialized
  request remains at or below the 140,000-byte hard cap.
- Confirmed: the public contracts under `src/contracts/`, database schema,
  migrations, UI, configured 50,000 aggregate output-token cap, USD 0.495 OpenAI
  reserve, retry policy, deadline, and paid-attempt settlement semantics were not
  changed by T6.
- Inferred: private packing fits the frozen official PDF.js-text representations
  with headroom because the exact serialized inputs pass the production request
  byte cap. The provider's exact tokenizer and real model output remain live-run
  evidence, not fixture evidence.
- Unknown: independent QA4 verdict, live Agent compliance with the private
  envelope on Edmonton/CER, exact provider token counts/cost, production latency,
  and the next deployment-bound result.

### Exact Checks

- `pnpm vitest run tests/unit/submission-adjudication.test.ts tests/unit/openai-adapter.test.ts tests/unit/materialize-reconciliation.test.ts tests/unit/summary-recovery.test.ts tests/unit/citations.test.ts tests/unit/closed-world.test.ts tests/unit/closed-template-recovery.test.ts tests/unit/core-field-recovery-materialize.test.ts tests/integration/openai-paid-cost-ledger.test.ts`:
  PASS, 9 files and 335 tests.
- `pnpm check`: PASS; ESLint and TypeScript passed, 54 test files passed/4
  skipped, and 662 tests passed/10 skipped.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and 13 static-generation entries completed.
- `git diff --check`: PASS; only Git's Windows LF-to-CRLF notices were emitted.
  `git diff --no-index --check -- NUL <path>` for each untracked T6 file emitted
  no whitespace error; exit 1 is the expected content-difference status.

### Risks and Follow-ups

- QA4 must independently challenge the Agent/coverage boundary with unseen
  language and malformed envelopes. Only `PASS` with P0=0/P1=0 can authorize the
  Chief's release sequence.
- Frozen fixture packing uses PDF.js text as the parsed-markdown stand-in. A real
  Monid representation may differ in byte/token size; exact provider preflight
  remains authoritative and must reject before paid dispatch if the package
  exceeds its existing bounds.
- Prompt-injection detection is intentionally conservative and taints the entire
  shared batch. This may withhold a true submission method, but cannot create a
  false unique method.
- The private schema reserves bounded adjudication capacity inside the existing
  50,000-token aggregate output ceiling. A live structured response that cannot
  complete remains `ANALYSIS_INCOMPLETE`; it is never accepted partially.

### Proposed Long-Term Memory

- Let the Agent adjudicate document semantics, but make deterministic code own
  complete coverage receipts, canonical identity, physical-page/offset evidence,
  version ordering, disagreement fences, and publication thresholds.
- A semantic subsystem should fail closed on incomplete coverage rather than grow
  a dictionary of grammar exceptions. Agent output is evidence to verify, not
  authority to trust blindly.
- Draft/presentation output may veto a stronger private evidence path, but it must
  never repair missing coverage or independently establish a critical fact.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## Revision 14 — T5 Unresolved-Evidence Resolver Redesign

T5 replaces the exhausted T4 syntax patches with one conservative evidence
classification and resolution contract. This is implementation evidence for
independent QA3, not self-certification. No network, credentials, deployment,
paid-provider call, commit, push, or governance change occurred.

### Changed Files

- `src/lib/analysis/submission-channel.ts`
- `src/lib/analysis/source-anchors.ts`
- `src/lib/analysis/materialize.ts`
- `tests/unit/closed-template-recovery.test.ts`
- `tests/unit/core-field-recovery-materialize.test.ts`
- `tests/unit/summary-recovery.test.ts`
- `tests/unit/materialize-reconciliation.test.ts`
- This Revision 14 section in `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### Decisions

- `classifySubmissionChannelEvidence` now returns classified relations plus
  bounded `UnresolvedSubmissionEvidence` entries and `blocksUniqueness`.
  Channel mentions are discovered before semantic classification; relevant
  mentions that cannot be assigned safely are fenced as unresolved instead of
  disappearing or being guessed.
- `resolveUniqueSubmissionChannel` is the sole uniqueness authority. It returns
  `unique`, `none`, `possible_only`, `multiple`, `contradicted`, or `unresolved`.
  A channel is unique only when there is no unresolved evidence, exactly one
  possible channel, that channel is publishable, and it is not prohibited.
- Physical line wraps are normalized before sentence segmentation. Procurement
  actors and whole-bid subjects are recognized symmetrically, while questions,
  invoices, and tender artifacts are excluded only when their scope is proven.
- Coordinated relations are split only at a later explicit recognized subject
  with a directly bound predicate. Elided-subject mixed polarity remains one
  unresolved unit. A positive relation and unconditional prohibition for the
  same channel resolve as contradicted.
- `use` is a delivery action only when directly bound to an actual channel
  object and explicit submission purpose. `email` is a delivery verb only when
  a whole-bid/procurement actor, modal predicate, and bid object are directly
  bound; formatting, encryption, signature, and foreign-subject uses remain
  outside channel evidence.
- Both strict source recovery and materialization now aggregate evidence and
  call the shared resolver. Verified citations from rejected model items still
  participate in the package ambiguity fence, and preferred/model summaries
  must agree with the same resolution.

### Confirmed / Inferred / Unknown

- Confirmed: required modifier, subject-order, quantifier, line-wrap,
  conditional-ban, unconditional-ban, ordinary multi-channel, contradiction,
  excluded-subject, prompt-adjacent noun, foreign-subject, actor-morphology,
  coverage, and monotonicity regressions pass.
- Confirmed: an Edmonton p6 Email anchor is withheld by unresolved or alternate
  verified channel evidence, while the official electronic-tendering download
  notice does not falsely block Email recovery.
- Confirmed: both read-only T5 auditors returned PASS with P0=0, P1=0, P2=0;
  one exercised a 70-case adversarial matrix and the other verified both
  production callers and the absence of public contract/database/UI changes.
- Inferred: the shared unresolved fence removes the false-unique failure class
  targeted by T5 without broadening the public API or persisted schema.
- Unknown: QA3's independent repository verdict and the next credentialed paid
  production run; neither is claimed by this handoff.

### Exact Checks

- `pnpm test -- tests/unit/closed-template-recovery.test.ts tests/unit/core-field-recovery-materialize.test.ts tests/unit/summary-recovery.test.ts tests/unit/materialize-reconciliation.test.ts`:
  PASS, 4 files and 403 tests.
- `pnpm check`: PASS; ESLint and TypeScript passed, 53 test files passed/4
  skipped, and 771 tests passed/10 skipped.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm test -- tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and 13 static-generation entries completed.
- Bounded `git diff --check` for tracked T5 paths plus
  `git diff --no-index --check -- NUL <path>` for the three untracked T5 files:
  PASS; only Git's Windows LF-to-CRLF notices were emitted.
- Read-only classifier/adversarial audit: PASS, P0=0/P1=0/P2=0, 70/70 matrix.
- Read-only caller/boundary audit: PASS, P0=0/P1=0/P2=0.

### Risks and Follow-ups

- This remains a bounded English procurement classifier, not a general grammar
  parser. Unsupported whole-bid channel scope deliberately blocks uniqueness as
  unresolved; this can withhold a true method but cannot create a false unique
  method.
- Safe excluded-subject handling is limited to explicit subject/predicate and
  declared modifier attachment. New language families require a failing
  regression before extending the classifier.
- QA3 must independently review Revision 14. Only its PASS with P0=0/P1=0 may
  authorize the Chief Agent's later release sequence.

### Proposed Long-Term Memory

- Evidence extraction must distinguish publishable, possible, prohibited, and
  unresolved channel evidence; unresolved evidence is a monotonic fence against
  uniqueness.
- Discover mentions before classification, prove every relevant mention's
  disposition, and resolve package uniqueness in one shared function used by
  every caller.
- Bind delivery verbs to the whole-bid subject and channel object. Nearby channel
  words in formatting, security, signature, or third-party clauses are not
  submission-method evidence.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## Revision 13 — QA2 Round-3 Bounded Subject Quantifiers

This final normal revision addresses QA2's P1 quantified-shared-predicate
finding without adding a general grammar parser. It is implementation evidence
for independent re-review, not self-certification. No network, credentials,
deployment, paid-provider call, commit, push, or governance change occurred.

### Changed Files

- `src/lib/analysis/submission-channel.ts`
- `tests/unit/closed-template-recovery.test.ts`
- `tests/unit/core-field-recovery-materialize.test.ts`
- This Revision 13 section in `docs/specs/MH-001-rfp-xray/handoff-backend.md`

`source-anchors.ts`, `materialize.ts`, and the official fixture audit required no
Revision 13 change because their existing paths consume the shared classifier.

### Decisions

- Whole-bid and excluded question/artifact subject starts accept only the
  bounded quantifiers `all`, `each`, `both`, `every`, and `any`, followed by an
  optional `the`. No arbitrary determiner or nested grammar was introduced.
- Quantifiers work on either coordinated subject and in either subject order.
  Only the whole-bid Portal relation survives; question/artifact relations stay
  excluded from whole-bid evidence.
- Shared-predicate projection now requires the predicate to follow the complete
  recognized excluded-subject span directly. It cannot scan across another
  coordinated clause or a nested relative clause and borrow a later invoice or
  question predicate.
- Ordinary channel coordination remains intact, so `email and portal` continues
  to produce two-channel ambiguity.

### Confirmed / Inferred / Unknown

- Confirmed: all five quantifiers pass classifier coverage for whole-bid,
  bid-security, and question subjects, including both subject orders and a
  quantifier on either coordinated side.
- Confirmed: an Edmonton-style p6 Email anchor is withheld for all quantified
  bid/bid-security order and quantifier-placement combinations.
- Confirmed: verified quantified Portal evidence from a rejected model Email
  claim enters package ambiguity and leaves the summary method null.
- Confirmed: the complete Revision 10-12 focused suite, official fixture audit,
  full local check, and production build remain green.
- Inferred: the bounded delta closes QA2 P1-QUANTIFIED-SHARED-PREDICATE without
  widening relation ownership.
- Unknown: QA2's independent post-Revision-13 verdict and the next paid
  production Edmonton result.

### Exact Checks

- Before the source delta, the two affected suites reproduced 41 failures across
  classifier, strict source recovery, and rejected-evidence materialization.
- `pnpm test -- tests/unit/closed-template-recovery.test.ts tests/unit/core-field-recovery-materialize.test.ts tests/unit/summary-recovery.test.ts tests/unit/materialize-reconciliation.test.ts`:
  PASS, 4 files and 305 tests.
- `pnpm check`: PASS; ESLint and TypeScript passed, 53 test files passed/4
  skipped, and 673 tests passed/10 skipped.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm test -- tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and 13 static-generation entries completed.
- Bounded tracked `git diff --check` plus `git diff --no-index --check` for the
  three still-untracked implementation/test files: PASS; only Git's Windows
  LF-to-CRLF notices were emitted.

### Risks and Follow-ups

- The classifier intentionally does not interpret arbitrary nested coordination,
  relative clauses, or new determiners. Unsupported ownership stays
  non-publishable until a source-grounded regression justifies expansion.
- QA2 must independently review Revision 13. Any remaining P1 exhausts the
  three-round loop and requires redesign or human direction rather than another
  patch.

### Proposed Long-Term Memory

- Bounded linguistic prefixes should be normalized consistently on every
  in-scope subject role, including either side of a coordination.
- Shared-predicate projection must bind directly to the recognized subject span;
  scanning across intervening prose can transfer an unrelated object's channel.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## Revision 12 — QA2 Round-2 Shared-Predicate Delta

This bounded revision addresses QA2's one P1 shared-predicate finding and its
one P2 anti-drift regression request against Revision 11. It is implementation
evidence for independent re-review, not self-certification. No network,
credentials, deployment, paid-provider call, commit, push, or governance change
occurred.

### Changed Files

- `src/lib/analysis/submission-channel.ts`
- `tests/unit/closed-template-recovery.test.ts`
- `tests/unit/core-field-recovery-materialize.test.ts`
- This Revision 12 section in `docs/specs/MH-001-rfp-xray/handoff-backend.md`

`source-anchors.ts`, `materialize.ts`, and the official fixture audit required no
Revision 12 code change because both production callers already consume the
shared classifier result.

### Decisions

- Coordinated subjects are no longer split blindly. If the left side is already
  a complete relation, the following excluded subject begins a separate clause.
- If a whole-bid subject precedes an excluded question/artifact subject and both
  share a later submission predicate, that predicate is projected onto the
  whole-bid subject before the excluded subject is filtered.
- If the excluded subject comes first, a complete later whole-bid relation is
  retained and the excluded subject is discarded. Both subject orders therefore
  preserve only the whole-bid channel.
- Ordinary channel coordination without a new semantic subject, such as `Bids
  must be submitted by email and through the portal`, is not split and remains a
  two-channel ambiguity.

### Confirmed / Inferred / Unknown

- Confirmed: whole-bid-first and artifact/question-first shared-predicate Portal
  clauses yield Portal only at classifier level.
- Confirmed: an Edmonton-style p6 Email anchor is withheld when a later strict
  section contains either shared-predicate Portal form.
- Confirmed: verified Portal evidence from a rejected model Email claim still
  enters package-wide ambiguity and prevents a false Email summary.
- Confirmed: the persisted ordinary Email+Portal regression remains ambiguous at
  classifier, strict source-recovery, and materialization layers.
- Inferred: this closes P1-SHARED-PREDICATE-COORDINATION without reopening either
  Revision 11 finding.
- Unknown: QA2's independent post-Revision-12 verdict and the next paid production
  Edmonton outcome.

### Exact Checks

- `pnpm test -- tests/unit/closed-template-recovery.test.ts tests/unit/core-field-recovery-materialize.test.ts tests/unit/summary-recovery.test.ts tests/unit/materialize-reconciliation.test.ts`:
  PASS, 4 files and 253 tests.
- `pnpm check`: PASS; ESLint and TypeScript passed, 53 test files passed/4
  skipped, and 621 tests passed/10 skipped.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm test -- tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and 13 static-generation entries completed.
- `git diff --check -- src/lib/analysis/submission-channel.ts tests/unit/closed-template-recovery.test.ts tests/unit/core-field-recovery-materialize.test.ts src/lib/analysis/source-anchors.ts src/lib/analysis/materialize.ts tests/golden/official-fixture-audit.test.ts docs/specs/MH-001-rfp-xray/handoff-backend.md`:
  PASS; only Git's Windows LF-to-CRLF notices were emitted.

### Risks and Follow-ups

- Shared-predicate projection is intentionally limited to one recognized
  whole-bid/excluded-subject conjunction with a source-visible submission action
  and channel. More complex nested lists remain fail-closed.
- QA2 must independently review Revision 12. Only a `PASS` with P0=0/P1=0 can
  close T4 and authorize the Chief's later production sequence.

### Proposed Long-Term Memory

- Coordination boundaries depend on predicate completeness, not conjunction text
  alone. When subjects share a predicate, preserve a source-grounded projection
  for the in-scope subject before filtering the out-of-scope subject.
- Channel-only coordination must remain intact so every named channel participates
  in package-wide ambiguity.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## Revision 11 — QA2 Round-1 Classifier Delta

This bounded revision addresses only QA2's two P1 findings against Revision 10.
It is implementation evidence for independent re-review, not self-certification.
No network, credentials, deployment, paid-provider call, commit, push, or
governance change occurred.

### Changed Files

- `src/lib/analysis/submission-channel.ts`
- `tests/unit/closed-template-recovery.test.ts`
- `tests/unit/core-field-recovery-materialize.test.ts`
- This Revision 11 section in `docs/specs/MH-001-rfp-xray/handoff-backend.md`

`source-anchors.ts`, `materialize.ts`, and the official fixture audit required no
Revision 11 code change because both callers already consume the shared
classification result.

### Decisions

- A direct channel ban is globally prohibited only when unconditional. A ban
  qualified by `after`, `before`, `if`, or another recognized condition remains
  `possibleChannels` evidence, is excluded from `publishableChannels`, and is not
  included in `prohibitedChannels`.
- Same-sentence coordination is split before unrelated-subject or tender-artifact
  filtering when `and` introduces questions, enquiries, invoices, bid security,
  bonds, samples, attachments, or the existing artifact family. The first
  whole-bid relation survives; only the unrelated/artifact relation is excluded.
- The split does not divide ordinary channel coordination such as `email and
  portal`, so multi-channel ambiguity remains fail-closed.

### Confirmed / Inferred / Unknown

- Confirmed: conditional direct Portal bans are possible-only; unconditional
  Portal/fax bans remain prohibited; coordinated questions-by-email and
  bid-security-by-email preserve only Portal.
- Confirmed: each behavior is covered at classifier, strict source-recovery, and
  materialization layers. A rejected model Email claim still contributes its
  verified Portal evidence to the package-wide ambiguity gate.
- Inferred: the semantic delta closes QA2 P1-CONDITIONAL-DIRECT-BAN and
  P1-COORDINATED-SUBJECT-RELATION without weakening Edmonton's Email recovery.
- Unknown: QA2's independent post-delta verdict and the next paid production
  Edmonton outcome.

### Exact Checks

- `pnpm test -- tests/unit/closed-template-recovery.test.ts tests/unit/core-field-recovery-materialize.test.ts tests/unit/summary-recovery.test.ts tests/unit/materialize-reconciliation.test.ts`:
  PASS, 4 files and 243 tests.
- `pnpm check`: PASS; ESLint and TypeScript passed, 53 test files passed/4
  skipped, and 611 tests passed/10 skipped.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm test -- tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and 13 static-generation entries completed.
- `git diff --check -- src/lib/analysis/submission-channel.ts tests/unit/closed-template-recovery.test.ts tests/unit/core-field-recovery-materialize.test.ts src/lib/analysis/source-anchors.ts src/lib/analysis/materialize.ts tests/golden/official-fixture-audit.test.ts docs/specs/MH-001-rfp-xray/handoff-backend.md`:
  PASS; only Git's Windows LF-to-CRLF notices were emitted.

### Risks and Follow-ups

- Conditional prohibitions remain ambiguity-only rather than proving the channel
  valid; this is intentionally conservative.
- The coordination split is limited to declared unrelated/artifact subject starts.
  New subject families require an explicit regression before extending it.
- QA2 must independently review Revision 11. Only a `PASS` with P0=0/P1=0 can
  close T4 and authorize the Chief's later production sequence.

### Proposed Long-Term Memory

- Channel prohibition is scoped by its condition; a time- or event-qualified ban
  cannot remove that channel from package-wide possibility.
- Split coordinated source relations at a new semantic subject before applying
  object filters, so an unrelated second object cannot erase a valid first fact.

Memory disposition: proposed only; Chief/Reviewer owns promotion or rejection.

## T9 QA7 Handoff Locator (Latest)

The complete bounded implementation handoff is the section **T9 Implementation
— Source-Ledger Package Authority** in this file. Its final evidence is: focused
T9/adjacent tests pass, official fixtures 3/3 pass, `pnpm check` passes with 731
tests passed/10 skipped, production build passes, and Playwright passes 14/2
skipped. No deployment, network/paid call, credential use, DB operation or
migration, commit, push, public route, or Reviewer-verdict edit occurred. QA7 is
the next independent gate.

## T10 Implementation — Three Independent Delivery Contracts

This is the bounded T10 implementation handoff for QA8. It is implementation
evidence, not self-certification. No network/provider call, credential access,
paid call, deployment, database operation, commit, push, public route, source
body persistence, channel lexicon, or Reviewer-verdict edit occurred.

### Implemented Contracts

1. **ExtractionDelivery** now uses a provider-private schema generated for each
   actual batch. `v=2`, the batch ID, and ledger digest are literals. The
   submission relation map is a strict object whose required keys are exactly
   the server-owned ordered candidate IDs and whose values are individually
   capped relation arrays. The identical generated format object is used for
   input-token counting and the paid parse request. Missing/extra candidate
   keys, wrong batch/digest literals, a missing inline relevance field, or any
   other schema mismatch stop the run as `ANALYSIS_INCOMPLETE`; a malformed
   returned response is cost-settled as failed and does not dispatch another
   paid batch.
2. **RecordPublicationAuthority** receives a required private
   `submission_relevance=s|n|u` on every emitted Claim, Requirement, Risk, and
   Evaluation rule. The server strips this field before creating the existing
   public `DraftAnalysis` and mechanically constructs the existing authority
   receipt. This removes the positional 40-tuple delivery dependency. The
   server-only maximum is 2,600 records, exactly the sum of the strict private
   collection maxima (1,000 Claims + 1,000 Requirements + 500 Risks + 100
   Evaluation rules). Existing canonical identity, exact citation, source
   occurrence, lineage, semantic crosscheck, receipt-size, and Q&A gates remain.
3. **SourceLedgerAdjudication** remains independently server-verified. Its
   `VerifiedSubmissionAdjudication` now records expected/verified batch counts
   in addition to the existing candidate, page, and fragment coverage. Record
   receipt failure still cannot replace a complete unique ledger result, and a
   complete record receipt cannot repair an incomplete ledger.

### Private Audit and Migration

- A strict `SubmissionAdjudicationAudit` v1 persists only its version, ledger
  SHA-256 digest, bounded expected/verified candidate/page/fragment/batch
  counts, unresolved batch count, completeness boolean, fixed resolution enum,
  all 22 fixed unresolved-reason counters, and timestamp. It rejects additional
  fields and inconsistent count/completeness combinations. It contains no
  source text, quote, window, URL, candidate/record ID, page value, offset, or
  raw model output.
- Successful production-shaped pipeline completion writes the actual source
  adjudication audit beside, but not inside, the record authority audit. It is
  retained after 24-hour result expiry and removed only with the run row at the
  existing 30-day audit expiry. New/historical rows are nullable; absence is not
  interpreted as success.
- Additive migration `0010_submission_adjudication_audit.sql` adds the nullable
  JSONB column and advances the application marker to
  `rfp-xray-schema-v11`. The schema probe now requires both independent audit
  columns. This migration was tested locally but was not applied to any
  database.
- Operator evidence is read with
  `node scripts/read-submission-adjudication-audit.mjs <run-id>`. The script
  validates a UUID, binds it as a query parameter, strictly parses the allowlist,
  emits only `run_id` plus the audit fields, and returns nonzero for absent or
  malformed evidence. It creates no public endpoint.

### Offline Falsification Evidence

- Local `zodTextFormat` generation accepted every dynamic official batch schema;
  strict `additionalProperties=false`, literal batch/digest fields, and exact
  required candidate keys are asserted. Edmonton generated three schema JSON
  envelopes of 29,389 / 32,029 / 32,029 bytes. CER generated five of 25,869 /
  26,749 / 25,869 / 28,509 / 24,111 bytes. These are formatter-envelope byte
  measurements, not provider-token or worst-case output claims.
- The compact submission control-plane preflight remains separate from the full
  response. Edmonton measures 4,772 / 5,339 / 5,696 bytes (15,807 aggregate);
  CER measures 4,180 / 3,979 / 4,406 / 4,517 / 6,164 bytes (23,246 aggregate).
  The provider's actual input-token count, deterministic per-plan output caps
  summing to 50,000, and plan-specific reserve gate remain authoritative.
- Tests reject missing/extra candidate keys, wrong batch/digest literals, and
  missing inline relevance; prove 41 inline-annotated records cross the former
  tuple boundary; prove malformed delivery is one paid dispatch, failed
  settlement, no retry; and show token-count/parse use the same generated
  format.
- Existing and newly connected falsifiers cover exact offset, low-confidence,
  overlap disagreement and their corresponding sanitized audit counters;
  unfamiliar SecureDrop uncertainty; prompt taint; corrupt record authority
  with independent Email; complete record authority with an incomplete ledger;
  canonical/lineage/Q&A suppression; strict redaction; deadline, usage,
  reservation, and zero-retry behavior.
- The official Edmonton fixture remains a complete unique Email result and the
  CER fixture preserves its established ambiguity/reconciliation outcomes. The
  unchanged limits are $2.00 total per run, $20.00 per day, and $0.495 OpenAI
  extraction reserve per run.

### Changed Files

- `src/lib/providers/openai.ts`
- `src/lib/analysis/record-authority.ts`
- `src/lib/analysis/submission-channel.ts`
- `src/lib/runs/submission-adjudication-audit.ts`
- `src/lib/runs/types.ts`
- `src/lib/runs/store.ts`
- `src/lib/pipeline.ts`
- `src/db/schema.ts`
- `src/db/neon-store.ts`
- `drizzle/0010_submission_adjudication_audit.sql`
- `drizzle/meta/_journal.json`
- `scripts/database-schema-probe.mjs`
- `scripts/read-submission-adjudication-audit.mjs`
- `tests/unit/openai-adapter.test.ts`
- `tests/unit/submission-adjudication.test.ts`
- `tests/unit/submission-adjudication-audit.test.ts`
- `tests/unit/record-authority-audit.test.ts`
- `tests/unit/migrations.test.ts`
- `tests/integration/record-authority-audit.test.ts`
- `tests/golden/official-fixture-audit.test.ts`
- This T10 section in `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### Exact Checks

- `pnpm exec vitest run tests/unit/migrations.test.ts tests/unit/database-health.test.ts tests/unit/openai-adapter.test.ts tests/unit/submission-adjudication.test.ts tests/unit/record-authority.test.ts tests/unit/submission-adjudication-audit.test.ts tests/unit/record-authority-audit.test.ts tests/integration/record-authority-audit.test.ts`:
  PASS, 8 files and 121 tests.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm exec vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests; all five PDFs remained outside Git.
- `pnpm check`: PASS; ESLint and TypeScript passed, 58 test files passed/4
  skipped, and 737 tests passed/10 skipped.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow
  steps, 5 workflows, and 13 static-generation entries completed.
- `pnpm exec playwright test`: PASS, 14 browser tests passed and 2 credentialed
  live-storage tests skipped.
- Scoped changed-content credential-pattern scan: PASS, zero suspicious secret
  values.

### Unknowns, Risks, and Next Gate

- Dynamic schema support is confirmed only through the installed SDK's local
  formatter and offline official fixtures. No provider/network call was
  authorized, so provider acceptance and actual post-T10 Edmonton audit values
  remain unknown until QA8 approves one controlled paid run.
- The schema-v11 migration is additive and nullable but unapplied. Deployment
  must migrate and pass `pnpm probe:database` before starting a T10 run; rolling
  application code back may leave the harmless nullable column in place.
- The strict candidate-key schema increases request-format size. Runtime provider
  token counting includes this exact format and the pre-dispatch plan-specific
  reserve check remains the controlling safety boundary; the offline byte
  measurements are usefulness evidence only.
- QA8 must independently falsify this handoff. No deployment or paid Edmonton
  run is authorized until QA8 returns `PASS` with P0=0 and P1=0.

### Proposed Long-Term Memory

None. T10 is a project-specific provider contract and requires production
falsification before any durable rule is proposed.

## T11 Implementation — Provider-private bounded-relation repair

This is the bounded T11 implementation handoff for QA9. It is implementation
evidence, not self-certification. No network/provider call, credential access,
paid call, deployment, database operation or migration, commit, push, public
route, source-body persistence, channel lexicon, closing-date inference, or
Reviewer-verdict edit occurred.

### Implemented contracts

1. The provider-private extraction wire is now version 3. Its strict dynamic
   schema still requires the exact server-owned candidate keys plus literal
   batch and ledger digests, but a relation now carries `start + length`; length
   is structurally limited to 1..500 UTF-16 code units and confidence to
   0.9..1. The decoder uses checked addition and rejects overflow as
   non-retryable `ANALYSIS_INCOMPLETE`. Wire v2 is rejected. Existing server
   window, occurrence, condition-containment, overlap, taint, unfamiliar-channel,
   budget, deadline, and zero-retry checks are unchanged.
2. Required inline record relevance is now the descriptive private enum
   `whole_bid_submission_channel | not_whole_bid_submission_channel | uncertain`.
   The server alone decodes it to the internal `s|n|u` receipt and strips it from
   public Draft data. Explicit relation ambiguity/unknown remains representable
   at decisive confidence and reaches the server's `semantic_uncertainty`
   fail-closed result rather than being disguised as low confidence.
3. Record-authority audit writes version 4. It separately exposes bounded
   `integrity_complete` and `package_veto` booleans, while retaining `complete`
   as their validated conjunction. Canonically merged relevance disagreement is
   counted as fixed enum `mixed`, not `missing`. Historical v3 audit rows remain
   strict-readable. The existing nullable JSONB column accepts v4; no SQL
   migration or public contract changed.
4. Canonical record-to-merged-ID planning now uses the same complete record set
   as `mergeDrafts`, so equivalent records with different model IDs cannot select
   inconsistent representative IDs. Multiple inline relevances still join
   conservatively and veto submission safety as a merge disagreement.
5. Once an Evaluation field is recovered and source-verified for a document,
   model-authored rules for that same document and field are excluded from
   reconciliation. Contrary model values and same-value/different-ID `s|u`
   records therefore cannot clear the recovered field. The ordinary authoritative
   model path remains covered when no field is recovered.
6. The record-audit operator reader strictly accepts historical v1-v3 and current
   v4 allowlists. It uses the UUID only as a bound lookup parameter and no longer
   echoes the raw run ID; stdout contains only sanitized audit fields, never
   source text, URLs, pages, offsets, record IDs, or provider output.

### Offline falsification evidence

- Local Structured Outputs formatting accepts wire v3 with exact dynamic keys
  and literals. Tests reject v2, missing/extra candidates, wrong digests,
  missing relevance, zero/501-length relations, confidence below 0.9, and
  checked-add overflow. Malformed delivery produces one failed paid settlement,
  no retry, and no later paid dispatch.
- Descriptive relevance is decoded across Claim, Requirement, Risk, and
  Evaluation. Explicit `ambiguous/unknown/unspecified` SecureDrop output reaches
  `semantic_uncertainty` and a null unresolved channel. The former 40-record
  positional boundary remains absent.
- Merge tests distinguish `mixed=1, missing=0` while keeping package veto
  observable independently of receipt integrity. Operator tests preserve strict
  historical v3 parsing and reject inconsistent or additional fields.
- Recovered Evaluation tests cover a contrary model value, same recovered value
  under a different model ID with uncertainty, and the no-recovery authoritative
  model control. Recovered citations remain exact and source-verified.
- Official local measurements under wire v3 are empirical formatter/control
  evidence, not provider-token or worst-case response claims. Edmonton dynamic
  schemas are 29,156 / 31,736 / 31,736 bytes; control-plane envelopes are
  4,744 / 5,308 / 5,659 bytes (15,711 aggregate), and the representative local
  authority receipt remains 4,225 / 262,144 bytes. CER dynamic schemas are
  25,716 / 26,576 / 25,716 / 28,296 / 23,998 bytes; control-plane envelopes are
  4,152 / 3,955 / 4,377 / 4,488 / 6,121 bytes (23,093 aggregate), and its
  representative local receipt remains 6,681 / 262,144 bytes.

### Changed files

- `src/lib/providers/openai.ts`
- `src/lib/analysis/record-authority.ts`
- `src/lib/analysis/materialize.ts`
- `src/lib/runs/record-authority-audit.ts`
- `scripts/read-record-authority-audit.mjs`
- `tests/unit/openai-adapter.test.ts`
- `tests/unit/record-authority.test.ts`
- `tests/unit/record-authority-audit.test.ts`
- `tests/integration/record-authority-audit.test.ts`
- `tests/golden/official-fixture-audit.test.ts`
- This T11 section in `docs/specs/MH-001-rfp-xray/handoff-backend.md`

`src/lib/analysis/submission-channel.ts` required no T11 code edit: the existing
server verifier already enforces checked source-window bounds after v3 decoding,
condition containment, maximum quote length, minimum confidence, semantic
uncertainty, overlap agreement, and prompt-taint gates.

### Exact checks

- `pnpm exec vitest run tests/unit/record-authority-audit.test.ts tests/integration/record-authority-audit.test.ts tests/unit/openai-adapter.test.ts tests/unit/record-authority.test.ts tests/unit/submission-adjudication.test.ts tests/unit/core-field-recovery-materialize.test.ts`:
  PASS, 6 files and 182 tests.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm exec vitest run tests/golden/official-fixture-audit.test.ts`:
  PASS, 1 file and 3 tests; all fixture PDFs remained outside Git.
- `pnpm check`: PASS; ESLint and TypeScript passed, 58 test files passed/4
  skipped, and 742 tests passed/10 skipped.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow steps,
  5 workflows, and all 13 static-generation entries completed.
- `pnpm test:e2e`: PASS, 14 browser tests passed and 2 credentialed live-storage
  tests skipped.
- `git diff --check`: PASS; only Git's Windows LF-to-CRLF notices were emitted.
- Scoped changed-content credential-pattern scan: PASS, zero suspicious secret
  values.

### Confirmed, inferred, unknown, and next gate

- Confirmed: the local provider schema formatter represents all T11 bounds and
  exact dynamic keys; all required local falsifiers and regression gates above
  pass without a provider call.
- Confirmed: run and daily caps remain $2.00 and $20.00; extraction reserve,
  token-count preflight, actual-plan request count, settlement, deadline, and
  zero-retry paths were not changed.
- Inferred: wire v3 removes the two production rejection classes observed in
  T10 (relations longer than 500 cannot parse, and decisive relations below 0.9
  cannot parse) while providing an explicit conservative uncertainty outlet.
- Unknown: actual provider acceptance and post-T11 Edmonton audit counts remain
  unproven because no deployment or paid/network run was authorized.
- QA9 is the next independent gate. Only its `PASS` with P0=0/P1=0 can authorize
  Chief-controlled deployment or production falsification.

### Proposed long-term memory

None. Wire v3 and audit v4 remain project-specific contracts pending independent
QA9 and a later controlled production run.

## T12 Implementation — Canonical ownership-core submission ledger

This is the bounded T12 implementation handoff for QA10. It is implementation
evidence, not self-certification. No network/provider call, credential access,
paid call, deployment, database operation or migration, commit, push, release
evidence edit, public API change, channel lexicon, closing-date inference, or
Reviewer-verdict edit occurred.

### Implemented contracts

1. The private submission ledger is now `submission-ledger-v2`. Every PDF.js
   page is partitioned into consecutive, mutually exclusive half-open cores of
   at most 2,700 UTF-16 code units. Each core receives at most 250 units of
   left and right context, keeping an interior context at the existing 3,200
   limit. Empty pages retain one deterministic zero-length core. Candidate and
   ledger identities bind document/page hashes plus both core and context
   bounds.
2. A relation has exactly one canonical owner: the core containing
   `start + floor((length - 1) / 2)`. The 250-unit halo fully contains every
   relation of at most 500 units owned at either side of a core boundary.
   Lexical occurrences are likewise assigned to exactly one owner and remain
   discovery hints only. Page coverage is counted only when cores are gapless
   from offset zero through the complete raw PDF.js page.
3. The provider-private wire is version 4. Its dynamic candidate-key object now
   strictly requires `{ coverage: complete|uncertain, relations: [...] }`.
   Relation and condition offsets are context-relative on the wire; the server
   converts them with checked addition and then applies the existing exact
   source-slice, 500-unit, condition-containment, confidence, prompt-taint, and
   semantic checks. Wire v3, missing coverage, missing/extra keys, wrong
   literals, and overflow are rejected without retry.
4. `coverage=uncertain` fails the candidate closed as
   `semantic_uncertainty`. A relation emitted from a context whose core does not
   own its midpoint fails with the new fixed `ownership_mismatch` reason.
   Duplicate decisions for the same exact span within the one owner remain
   fail-closed as `overlap_disagreement`. The former requirement that every
   adjacent context duplicate the same relation was removed.
5. Submission-adjudication audit writes strict version 2 with the bounded
   `ownership_mismatch` counter while retaining strict historical version-1
   reads. The existing nullable JSONB needs no SQL migration. The authorized
   operator reader accepts only the historical/current union and no longer
   echoes the lookup UUID; stdout remains a non-body allowlist without text,
   URL, page, offset, candidate, or provider-output fields.
6. Record-authority mixed relevance remains fail-closed. T12 did not change
   `record-authority.ts`, `materialize.ts`, budgets, deadlines, call count,
   settlement, retries, persistence schemas, or public contracts.

### Offline falsification evidence

- Synthetic boundary tests prove cores `[0,2700)`, `[2700,5400)`, and the
  final remainder are gapless; every offset has one owner; contexts stay at or
  below 3,200; and 500-unit relations immediately on either side of offset
  2,700 are fully visible and have exactly one owner.
- A relation present in two adjacent contexts publishes when only its owner
  emits it, with no overlap-disagreement veto. The same relation emitted by the
  non-owner produces `ownership_mismatch`; two conflicting classifications of
  the same exact owner span produce `overlap_disagreement`.
- The v4 adapter test uses a nonzero context start and proves both relation and
  contained condition offsets become the correct absolute PDF.js offsets and
  hashes. Separate tests cover explicit core uncertainty, an empty page/admin
  core, clear Email, explicit unfamiliar SecureDrop, ambiguous SecureDrop,
  prompt taint, malformed delivery, checked overflow, and one paid settlement
  with no retry.
- Official local fixtures remain empirically within the unchanged controls.
  Edmonton now has 85 canonical cores in 3 batches; v4 control-plane bounds are
  5,426 / 6,005 / 7,318 bytes (18,749 aggregate, 31,251 aggregate reserve), and
  dynamic schemas are 35,495 / 32,516 / 39,475 bytes. CER now has 116 cores in
  5 batches; control-plane bounds are 4,834 / 4,766 / 4,800 / 5,928 / 7,006
  bytes (27,334 aggregate, 22,666 reserve), and dynamic schemas are 30,526 /
  29,537 / 31,527 / 34,506 / 27,546 bytes. These are local formatter/control
  measurements, not provider-token or worst-case public response claims.
- The representative local record-authority receipt is 4,123 / 262,144 bytes
  for Edmonton after ownership IDs changed and remains 6,681 / 262,144 bytes
  for CER. The official audit still validates all golden citations and package
  facts; fixture PDFs remained outside Git.

### Changed files

- `src/lib/analysis/submission-channel.ts`
- `src/lib/providers/openai.ts`
- `src/lib/runs/submission-adjudication-audit.ts`
- `scripts/read-submission-adjudication-audit.mjs`
- `tests/helpers/submission-adjudication.ts`
- `tests/unit/openai-adapter.test.ts`
- `tests/unit/submission-adjudication.test.ts`
- `tests/unit/submission-adjudication-audit.test.ts`
- `tests/unit/record-authority.test.ts`
- `tests/unit/summary-recovery.test.ts`
- `tests/integration/record-authority-audit.test.ts`
- `tests/golden/official-fixture-audit.test.ts`
- `docs/specs/MH-001-rfp-xray/tasks.md`
- This T12 section in `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### Exact checks

- `pnpm exec vitest run tests/unit/submission-adjudication.test.ts tests/unit/openai-adapter.test.ts tests/unit/submission-adjudication-audit.test.ts tests/unit/record-authority.test.ts tests/unit/summary-recovery.test.ts tests/integration/record-authority-audit.test.ts --reporter=dot`:
  PASS, 6 files and 165 tests.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm exec vitest run tests/golden/official-fixture-audit.test.ts --reporter=dot`:
  PASS, 1 file and 3 tests; all five PDFs remained outside Git.
- `pnpm check`: PASS; ESLint and TypeScript passed, 58 test files passed/4
  skipped, and 750 tests passed/10 skipped.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow
  steps, 5 workflows, and all 13 static-generation entries completed.
- `pnpm test:e2e`: PASS, 14 browser tests passed and 2 credentialed live-storage
  tests skipped.
- `git diff --check`: PASS; only Git's Windows LF-to-CRLF notices were emitted.
- Scoped changed-content credential-pattern scan: PASS, zero suspicious secret
  values.

### Confirmed, inferred, unknown, and next gate

- Confirmed: all local falsifiers and regression gates above pass; no extra
  model request, retry, provider path, budget path, or deadline behavior was
  introduced.
- Confirmed: the ledger remains all-page and source-bound. Adjacent halo is now
  interpretation context rather than a second semantic vote or authority unit.
- Inferred: canonical ownership removes the production overlap-disagreement
  failure class without weakening unknown-channel, ambiguity, mixed-record,
  exact-offset, or prompt-taint gates.
- Unknown: provider acceptance of wire v4 and actual post-T12 Edmonton audit
  counts remain unproven because no network or paid run was authorized.
- QA10 is the next independent gate. Only its `PASS` with P0=0 and P1=0 can
  authorize Chief-controlled deployment or production falsification.

### Proposed long-term memory

None. The ownership-core and v4 wire remain project-specific contracts pending
independent QA10 and a later controlled production run.

## T12 QA10 Revision 1 — Halo-context record-authority fence

This bounded revision addresses only
`P1_QA10_HALO_CONTEXT_BECOMES_RECORD_AUTHORITY`. It is implementation evidence,
not self-certification. No network/provider call, credential access, paid call,
deployment, database operation or migration, public contract change, channel
lexicon, commit, push, release-evidence edit, or Reviewer-verdict edit occurred.

### Exact delta

- `src/lib/analysis/record-authority.ts` now binds each exact citation quote
  occurrence only to the unique candidate whose half-open owned core contains
  `start + floor((length - 1) / 2)`. Full containment in that owner's bounded
  context remains required. Adjacent candidates that merely enclose the quote
  in halo context are no longer included in citation coverage or relation
  cross-check authority.
- No submission-ledger, provider-wire, materialization, Q&A, audit-schema,
  persistence, cost, deadline, retry, or public API code changed. A non-owner
  relation still fails `ownership_mismatch`; owner uncertainty remains
  fail-closed; record-relevance disagreement remains a package veto.
- `tests/unit/record-authority.test.ts` adds the exact Reviewer reproduction:
  `Bids must be lodged through SecureDrop.` at `[2685,2724)`, straddling the
  2700 boundary. The `[2700,...)` owner is uncertain while the `[0,2700)` halo
  is complete with no relation. The financial `n` Requirement becomes
  `coverage_gap / unknown / discarded`, record receipt integrity remains
  complete with `package_veto=false`, submission resolution stays null, the
  Requirement is absent, and persisted-evidence Q&A returns `not_found`.
- Positive controls prove the same exact unfamiliar-channel record publishes
  only when the midpoint owner is complete with a compatible exact relation,
  and exact non-submission citations at both page edges bind and publish through
  their respective owners.

### Changed files in this revision

- `src/lib/analysis/record-authority.ts`
- `tests/unit/record-authority.test.ts`
- `docs/specs/MH-001-rfp-xray/tasks.md`
- This revision section in
  `docs/specs/MH-001-rfp-xray/handoff-backend.md`

### Exact checks

- `pnpm exec vitest run tests/unit/record-authority.test.ts tests/unit/submission-adjudication.test.ts tests/unit/summary-recovery.test.ts tests/unit/closed-world.test.ts --reporter=dot`:
  PASS, 4 files and 129 tests.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm exec vitest run tests/golden/official-fixture-audit.test.ts --reporter=verbose`:
  PASS, 1 file and 3 tests; Edmonton and CER frozen local evidence and T12
  capacity/format measurements remain unchanged.
- `pnpm check`: PASS; ESLint and TypeScript passed, 58 test files passed/4
  skipped, and 753 tests passed/10 skipped.
- `pnpm build`: PASS; Next production compilation, TypeScript, 9 Workflow
  steps, 5 workflows, and all 13 static-generation entries completed.
- `pnpm test:e2e`: PASS, 14 browser tests passed and 2 credentialed live-storage
  tests skipped.
- `git diff --check`: PASS; only Git's Windows LF-to-CRLF notices were emitted.
- Scoped changed-content credential-pattern scan: PASS, zero suspicious secret
  values.

### Confirmed, inferred, unknown, and next gate

- Confirmed: a verified halo context can no longer substitute for the unique
  owner core in any Claim, Requirement, Risk, or Evaluation citation binding;
  the shared `exactOccurrences` path covers all four collections.
- Confirmed: owner uncertainty suppresses lineage, publication, and Q&A for the
  affected record without fabricating a record-level package veto. Independent
  source-ledger incompleteness still keeps the submission summary null.
- Confirmed: all prior T11/T12 local gates, unfamiliar-channel behavior, mixed
  fail-closed behavior, provider call count, zero-retry rule, costs, and
  deadlines remain green or unchanged.
- Unknown: post-revision provider behavior and production Edmonton audit values
  remain unproven because deployment and network/paid calls were forbidden.
- QA10 must independently review Revision 1. Deployment remains blocked until
  the Reviewer returns `PASS` with P0=0 and P1=0.

### Proposed long-term memory

None. This is a project-specific citation-ownership correction.
