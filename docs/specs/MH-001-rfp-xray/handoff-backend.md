# Backend Implementation Handoff

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
  state transitions, cleanup gating, budget reservation/settlement, hourly run quota,
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
- The product accepts the stricter hourly defaults (3 guest runs/hour, 30 API
  runs/hour) in addition to one active run and the global daily cost budget.
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
