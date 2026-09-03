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
- `pnpm build`: PASS, 10 Workflow steps, 4 workflows, 13 pages.
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
- GitHub did not emit a `schedule` event during the observation window. It is
  redundant only and is not claimed as the source of scheduled-delivery proof.

Monid, provider-contract, production Turnstile, paid Edmonton/CER, end-to-end
cleanup/cost/latency, citation click-through, video, submission, and
publication gates remain open. The release remains `NOT_READY`.
