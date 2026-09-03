# Frontend Implementation Handoff

## Assignment

- Implement the MH-001 English procurement-analysis working surface within the T3 frontend boundary.
- Cover URL and PDF pack staging, base/amendment roles, client validation, direct uploads, run creation and polling, cleanup gating, errors, the Edmonton sample, six result views, citations and lifecycle labels, cost provenance, document-only disclosure, provider-retention disclosure, progressive WebMCP tools, and desktop/mobile browser tests.
- No provider calls, deployments, API implementation changes, dependency changes, or configuration changes were made by this assignment.

## Inspected Files

- `AGENTS.md`
- `docs/agents/roles/frontend.md`
- `docs/agent_context/current_task_brief.md`
- `docs/agent_context/current_system_state.md`
- `docs/agent_context/known_risks.md`
- `docs/agent_context/qa_regressions.md`
- `docs/specs/MH-001-rfp-xray/spec.md`
- `docs/specs/MH-001-rfp-xray/plan.md`
- `docs/specs/MH-001-rfp-xray/tasks.md`
- `docs/specs/MH-001-rfp-xray/agent_routing.yaml`
- `docs/specs/MH-001-rfp-xray/qa_gate.yaml`
- All TypeScript contracts under `src/contracts/`
- `src/app/page.tsx`, `src/app/layout.tsx`, and the previous `src/app/globals.css`
- The existing Playwright configuration was read to understand its test projects and local web-server behavior; it was not changed by this assignment.
- Current WebMCP imperative API documentation from the W3C draft and Chrome documentation was checked before implementation.

## Changed Files

- `src/app/page.tsx`
- `src/app/layout.tsx`
- `src/app/globals.css`
- `src/components/rfp-workspace.tsx`
- `src/components/analysis-surface.tsx`
- `tests/e2e/rfp-workspace.spec.ts`
- `docs/specs/MH-001-rfp-xray/handoff-frontend.md`

`public/og.png` was supplied by the Chief Agent and reused from layout metadata; this frontend assignment did not replace the asset.

## Decisions

- Used a compact, light, public-sector workspace treatment with one civic-blue action palette, a single radius system, semantic status colors, high information density, and no decorative hero treatment.
- Kept the source builder and a useful Edmonton sample visible in the first desktop viewport. On narrow screens, a first-viewport sample shortcut avoids forcing users to scroll past the complete source form.
- Used native CSS and Lucide icons already available in the repository. No dependency or configuration request was needed.
- Treated `cleanup_pending` as a hard presentation gate. The client does not request or render the analysis until cleanup is confirmed.
- Used the locked primary endpoints: `GET /api/v1/samples/edmonton` and `GET /api/v1/runs/{run_id}/analysis`. Compatibility aliases are not used by the frontend.
- Implemented WebMCP only after feature detection of `document.modelContext.registerTool`. Tools load the Edmonton sample or stage, but do not submit, a CanadaBuys URL. An `AbortController` unregisters both tools during React cleanup.
- Kept trust semantics visible at the point of use: claim lifecycle, citation verification, actual versus estimated costs, document-only/no-search operation, and provider-retention disclosure are not collapsed into a generic success state.
- Reset terminal failed or expired run identifiers before offering retry, ensuring retry starts a fresh run instead of polling a terminal run again.
- Preserved the run-creation idempotency key across an uncertain create-request retry, then cleared it after a confirmed creation response or an explicit source reset.

## Confirmed

- URL inputs accept only HTTPS URLs hosted at `canadabuys.canada.ca`, permit one base plus up to four amendments, and keep exactly one selected base document.
- PDF staging accepts up to five documents, identifies non-PDF and over-25-MB files, hashes bytes with SHA-256 in the browser, requests presigned upload data, and uploads directly with the returned method and headers before run creation.
- Mutating and owned-run requests use `credentials: "same-origin"`; run creation supplies a unique `Idempotency-Key`.
- Run rendering covers local preparation, `queued`, `processing`, `cleanup_pending`, `ready`, `partial`, `failed`, `expired`, recoverable request errors, and user cancellation of polling.
- The result surface contains Executive Brief, Compliance Matrix, Evaluation & Pricing, Risks & Conflicts, Ask This RFP, and Audit & Cost views.
- Result navigation supports pointer activation plus Arrow Left, Arrow Right, Home, and End keyboard behavior with tab/panel semantics.
- Every tab owns a persistent, correctly referenced panel, so switching views does not discard a drafted question or leave inactive `aria-controls` targets unresolved.
- Pricing that is absent is rendered as unknown, never as zero. Cost rows distinguish actual and estimated amounts.
- Claim and citation elements visibly distinguish active, superseded, conflicted, and needs-review states. Citation details include physical page, document, quote, printed label/section when present, verification method, and source hash.
- Reduced-motion preferences disable non-essential transitions and spinners; focus-visible styles are present across interactive controls.

## Inferred

- The server's signed session cookie is sufficient for guest ownership because the frozen API requires same-origin credentials and does not define a separate browser authentication exchange.
- `status_url` returned by run creation/status is safe to follow only when it remains an app-local `/api/v1/runs/` path; otherwise the client falls back to the canonical run-status path.
- A `ready` or `partial` status with cleanup confirmed authorizes the separate analysis fetch. No successful result is inferred from progress or HTTP status alone.
- Provider-retention text must remain a disclosure, not a guarantee, until provider-specific production terms are independently verified.

## Unknown

- Production Turnstile token acquisition is not wired because the frozen browser contract does not specify a token source. The API currently treats `X-Turnstile-Token` as optional.
- A real production object-store CORS policy and cross-origin presigned PUT were not exercised; E2E coverage mocks that browser boundary.
- Provider-specific retention terms and any zero-retention eligibility remain unverified and are labeled as such in the UI.
- No browser in the verification environment exposed native WebMCP. Registration, tool execution, staged input, and cleanup were verified with a standards-shaped browser mock.

## Checks and Exact Outcomes

- `pnpm exec eslint src/app/page.tsx src/app/layout.tsx src/components/analysis-surface.tsx src/components/rfp-workspace.tsx tests/e2e/rfp-workspace.spec.ts` -> PASS, exit code 0.
- `pnpm exec tsc --noEmit --pretty false` -> PASS, exit code 0.
- `pnpm exec playwright test tests/e2e/rfp-workspace.spec.ts` -> PASS on the final frontend state, 10 tests passed across Chromium desktop and mobile projects in 14.9 seconds, including web-server startup.
- `pnpm check` -> PASS on the final shared-tree state. ESLint and TypeScript passed; Vitest reported 11 passed and 1 skipped test files, with 31 passed and 2 skipped tests, in 3.76 seconds.
- `pnpm build` -> PASS on the final shared-tree state. Next.js 16.3.4 compiled successfully in 7.0 seconds, TypeScript completed in 11.3 seconds, and 13 static pages were generated.
- Visual inspection -> PASS for desktop idle, desktop sample result, mobile idle, and mobile Audit & Cost captures. The source/sample choice remained useful in the first viewport, tab overflow stayed local to the navigation strip, and no page-level horizontal overflow was visible.
- Frontend preflight scan for en/em dashes, `h-screen`, `navigator.modelContext`, legacy sample/result endpoints, and placeholder copy -> PASS with no matches in the frontend-owned source and test paths.
- These are implementation-worker results only. Independent Reviewer and QA verdicts remain required; this handoff does not self-certify completion.

## Assumptions

- The API returns payloads conforming to the frozen contracts, including snake_case fields and a populated `status_url` where defined.
- The five-file and 25-MB-per-file client limits are early feedback; the server remains authoritative for MIME, total page count, integrity, ownership, and cleanup.
- The Edmonton sample is deterministic and may be opened without creating a run or uploading source bytes.
- Source URLs are staged as user input and are not fetched by the browser before run creation.

## Risks

- Browser SHA-256 hashing reads each selected file into memory before upload. The bounded 25-MB document limit constrains this, but lower-memory mobile devices may still experience a brief pause.
- A server response that omits a usable error envelope must be converted to generic user-facing copy; request IDs appear only when the backend supplies one.
- The result surface intentionally exposes dense audit evidence. It remains responsive, but very long server-provided titles, quotes, or candidate values should be included in independent overflow testing.
- The WebMCP API remains an evolving browser capability, so the implementation is progressive and the normal UI never depends on it.

## Follow-ups

- Independent Reviewer should compare all frontend behavior against the frozen contracts and verify no cleanup-gated result can leak through a race.
- QA should run the full project gate and E2E suite from a clean server process, and should inspect one real presigned upload when a non-production test object store is available.
- Product/legal should replace the provider-retention disclosure only after production provider terms are confirmed.
- If production Turnstile becomes mandatory, freeze a client token-acquisition contract before adding that header to mutations.

## Proposed Long-Term Memory

- Preserve the UI trust rule: `cleanup_pending` is not success, absent price is not zero, lifecycle state must travel with claims/citations, and provider retention remains explicitly unverified until independently confirmed.
- Preserve the locked frontend endpoint names: `/api/v1/samples/edmonton` and `/api/v1/runs/{run_id}/analysis`.

## Memory Disposition

- Proposed only. No durable memory was promoted by the frontend implementation worker.
