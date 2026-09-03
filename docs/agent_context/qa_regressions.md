# QA Regressions

Updated: 2026-09-03

| ID | Fragile behavior | Required check | Last result |
|---|---|---|---|
| QR-1 | Edmonton PDF has 55 physical pages although the printed body ends at 47 | Golden page/form audit test | pass: 55 pages, 221 fields, 231 widgets |
| QR-2 | M3 means up to three resources, not exactly three | Edmonton mandatory golden test | pass |
| QR-3 | Blank pricing placeholders are unknown, never zero | Edmonton pricing golden test | pass for p40-p42 |
| QR-4 | Edmonton Annex D/E security cross-reference is inconsistent | Conflict golden test | pass |
| QR-5 | CER amendment order must not depend on upload order | Permutation reconciliation test | pass at helper and materialization levels |
| QR-6 | Amendment 003 contains an unresolved 2050/2055 contradiction | Three-citation conflict test | pass with p2/p5/p6 despite topic drift |
| QR-7 | Superseded claims and requirements remain auditable but are not current | CER materialization replacement regression | pass; dependent stale risk withheld |
| QR-8 | Any cleanup failure blocks both terminal success and result reads | Pipeline, expiry, DELETE, and result-route regressions | pass locally |
| QR-9 | PDF instructions, JavaScript, and links remain inert | Closed-world injection test | pass locally |
| QR-10 | Critical citation page and quote accuracy remain 100% | Golden citation validator and reviewer click test | pass locally; 113 occurrences/109 unique official citations |
| QR-11 | Guest mutations obtain a fresh Turnstile token in production | Production-path browser and server-verifier tests | pass locally; live keys/browser deployment check open |
| QR-12 | Missing live infrastructure never selects memory/local production adapters | Health and production-config tests plus deployed health smoke | pass locally; older deployed `/api/health` returns 503 `not_ready`; committed S3 build redeploy pending |
| QR-13 | Model request bytes/tokens and maximum cost stay within reservation | Adversarial 300-page/large-chunk unit test | pass; aggregate deadline added |
| QR-14 | Monid artifact fetch cannot reach arbitrary/private hosts or redirects | SSRF adapter tests | pass locally |
| QR-15 | Abandoned/replayed signed uploads are removed by a durable sweep | Private-storage adapter/workflow tests plus live Railway replay probe | live signed replay/CAS/delete and browser-origin replay passed; end-to-end sweep open |
| QR-16 | Reused model IDs combine one record's prose with another record's citations | Cross-batch ID and direct materialization adversarial tests | pass |
| QR-17 | Labels and numbers are semantically swapped (70/30, 50/94, MDT/EST) | Field-binding citation tests | pass |
| QR-18 | Run row survives a crash before Workflow scheduling | Idempotent replay and maintenance recovery tests | pass locally |
| QR-19 | Presign flood bypasses run quota | Outstanding/daily/global concurrent issuance tests | pass locally and live Neon concurrency probe passed; deployed flow open |
| QR-20 | Hourly counting or a lower retry settlement weakens daily spend controls | Cross-hour daily quota and monotonic settlement tests | pass locally |
| QR-21 | Concurrent create or enqueue acknowledgement loss kills an admitted run | Admission lease, delayed-workflow, and uncertain-scheduler tests | pass locally; live Workflow gate open |
| QR-22 | Adjacent title/issuer/timezone labels or a false amendment topic authorize another fact | Span binding, ambiguous-deadline, non-deadline mutation, and comma-separator adversarial tests | pass locally |
| QR-23 | Missing upload ledger causes cleanup to create an orphan fence | No-ledger/no-object and orphan-object private-storage adapter tests | pass locally; live Railway CAS/delete contract passed; deployed sweep open |
| QR-24 | Conditional or negated prose is published as current fact | Closing, selection, submission, evaluation, and mutation polarity suites | pass |
| QR-25 | M3 `up to three` loses its maximum bound | Objective qualifier completeness regression | pass |
| QR-26 | Old/new or amount/currency roles are spliced across mutation targets | Terminal-target and typed scalar tuple regressions | pass |
| QR-27 | Mandatory predicate or submission channel is borrowed from an adjacent object | Coordinated-subject and bid-artifact relation regressions | pass |
| QR-28 | Insurance premium, contract fee, or forecast payment steals a destructive closed key | Closed taxonomy and Basis of Payment subfield regressions | pass |
| QR-29 | Operational deadline or scoring comparison populates executive summary | Closing/selection object allowlist regressions | pass |
| QR-30 | Model-authored risk action retains a superseded scalar | Mixed-lineage and source-unbound action regressions | pass |
| QR-31 | Amendment-cited old value escapes stale-risk invalidation because its SHA differs | Cross-document stale-risk materialization regression | pass |
| QR-32 | Database migrations or contention controls diverge | Verify schema marker, 9 public tables and 8 migration rows; rerun migrations; execute application contention and real CAS-loss probes | pass: schema v8 marker and live concurrency 2/2 |
| QR-33 | Sample deployment is mislabeled as live-provider ready | Check sample routes, build currency, and health independently | pass boundary check: three older public surfaces 200, health 503 `not_ready`, remote read-only Playwright 4/4; committed redeploy required |
| QR-34 | Read-only reachability is accepted as complete deployed browser/citation QA | Run live production mutation flow and click at least 12 high-risk citations | open: interactive in-app automation unavailable and live provider gates blocked |
| QR-35 | Railway Bucket accepts signed upload replay or retains old object versions | Live exact PUT/replay, CAS fence, post-fence replay, delete/absence, CORS, and versioning checks | bound attestation valid to 2026-09-10 04:11:53 MDT; S3 live 1/1 and production-Origin Chromium 1/1 passed |
| QR-36 | Workflow execution exceeds its inspected Vercel capability | Assert Node 22/Fluid settings, deployment-bound 300-second route facts, 105/150/285-second deadlines, Monid concurrency 4, then run real provider benchmark | attestation implementation independently approved P0/P1/P2=0; current receipt and live benchmark open |
| QR-37 | Live verifier executes paid work without deliberate opt-in or leaks evidence | Verify exact paid gate, campaign budget, cleanup, unknown-result lockout, and sanitized output | independent verifier audit PASS P0=0/P1=0; paid path never run |
| QR-38 | Vercel S3 secrets/attestations are treated as deployed without a new build | Redeploy committed revision, store exact deployment-bound receipts, and repeat health/remote smoke before live mutations | open: implementation commit `dfc8be9` is local; public build is older |
| QR-39 | Provider code runs against a drifted Monid/OpenAI contract | Require a current provider-contract attestation before source or paid work and test mismatch/expiry paths | implementation independently approved P0/P1/P2=0; no receipt/calls while Monid key/config is absent |
| QR-40 | Paid work replays or escapes the durable cost ledger | Record pending max-cost commitment immediately before dispatch, atomically settle, and block unknown outcomes | pass; final security re-review APPROVE P0=0/P1=0 and both P2 recommendations implemented/tested |
| QR-41 | Cleanup maintenance silently stops or runs against stale code | Require an authenticated bounded heartbeat and freshness gate | secret rotated consistently; GitHub maintenance variable intentionally false until new deployment |
| QR-42 | The integrated pre-deploy suite regresses after hardening | Run check, build, local E2E, official fixtures, production audit, and full high/critical gate | pass: check 39 files/391 tests with 3 files/7 tests skipped; build 10 steps/4 workflows/13 pages; E2E 14/2; fixtures 3/3; production audit clean; full audit 0 high/critical with 1 low/3 moderate development findings |
| QR-43 | Short-lived S3/runtime/provider receipts expire before submission | Refresh them on the scheduled release heartbeat | scheduled for Sep 9 and Sep 10 at 12:00 MDT; execution pending |
| QR-44 | Pinned release tooling drifts or dependency overrides break attestations | Assert Vercel CLI 59.11.2 and run focused runtime/provider attestation tests | pass: pinned version confirmed and 33 focused tests passed |
| QR-45 | A slow durable pre-dispatch write leaves OpenAI with a stale timeout computed before the paid call | Recompute the aggregate deadline immediately after the durable callback and prove an expired deadline sends zero paid requests | pass: focused regression records a zero-cost failed settlement with `attemptedBatches=0`; full suite remains 391/7 |
