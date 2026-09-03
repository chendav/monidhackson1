# Tasks

## T1 Shared foundation

```yaml
id: T1
owner_profile: chief
objective: Freeze provider facts, scaffold, contracts, fixtures, and ownership boundaries.
depends_on: []
include_paths: [package.json, src/contracts/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: []
edits_allowed: true
acceptance: [AC-1, AC-4, AC-7]
handoff: handoff-chief.md
status: completed
```

## T2 Backend and AI pipeline

```yaml
id: T2
owner_profile: backend
objective: Implement storage, ingestion, parsing, cleanup, extraction, reconciliation, API, and server tests.
depends_on: [T1]
include_paths: [src/app/api/**, src/lib/**, src/db/**, drizzle/**, tests/unit/**, tests/integration/**, tests/golden/**]
exclude_paths: [src/app/page.tsx, src/components/**, src/app/globals.css, tests/e2e/**]
edits_allowed: true
acceptance: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-9]
handoff: handoff-backend.md
status: local-release-candidate-approved-live-gates-open
```

## T3 Frontend working surface

```yaml
id: T3
owner_profile: frontend
objective: Implement the responsive English upload, progress, analysis, citation, Q&A, and cost experience.
depends_on: [T1]
include_paths: [src/app/page.tsx, src/app/layout.tsx, src/app/globals.css, src/components/**, tests/e2e/**]
exclude_paths: [src/app/api/**, src/lib/**, src/db/**, drizzle/**]
edits_allowed: true
acceptance: [AC-8, AC-10]
handoff: handoff-frontend.md
status: local-release-candidate-approved-live-gates-open
```

## QA1 Independent review

```yaml
id: QA1
owner_profile: reviewer
objective: Independently verify every acceptance criterion and regression without editing implementation.
depends_on: [T2, T3]
include_paths: [src/**, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: passed-local-cc2831c
```

## REV-1 Release blockers

```yaml
id: REV-1
objective: Resolve the independent review's one P0 and six P1 findings without broadening product scope.
frontend_scope:
  - fresh action-bound Turnstile token lifecycle for every guest mutation
  - production-path browser coverage and accessible failure state
backend_scope:
  - cleanup/expiry/result release invariant and abandoned/replayable uploads
  - verified summary materialization and requirement reconciliation
  - complete production configuration gate and health semantics
  - bounded OpenAI input/output, token-cost accounting, and budget reservation
  - allowlisted/public-network Monid artifact retrieval
  - complete Edmonton/CER frozen golden assertions
  - patched high-severity transitive dependencies
review: independent re-review required
status: closed-local-cc2831c
```

## EXT-1 Credentialed production evidence

```yaml
id: EXT-1
owner_profile: chief
objective: Verify Monid, Blob, Neon, Workflow, Turnstile, cost, latency, production citations, deployment, video, and publication evidence with real credentials.
depends_on: [QA1]
include_paths: [docs/specs/MH-001-rfp-xray/**]
exclude_paths: []
edits_allowed: true
acceptance: [AC-1, AC-3, AC-5, AC-6, AC-8, AC-9, AC-10]
handoff: qa_report.md
status: deployed-fail-closed-monid-turnstile-open
confirmed_progress:
  - Public sample deployment is reachable at https://rfp-xray.vercel.app.
  - Landing, OpenAPI, and Edmonton sample returned HTTP 200 on 2026-09-03.
  - Health returned 503 not_ready, preserving the production fail-closed gate.
  - Remote read-only Playwright deployment smoke passed 4/4 without mutations or paid calls.
  - Active Neon reports nine public tables, eight migration rows, schema v8 marker; live concurrency including a real CAS-loss passed 2/2.
  - Dedicated Railway private Bucket has a bound attestation through 2026-09-10 04:11:53 MDT; current S3 live and real Chromium production-Origin probes each passed 1/1.
  - Railway provides private S3-compatible storage plus one no-domain, zero-idle-instance maintenance Cron; it runs no RFP analysis worker.
  - Vercel project settings are Node 22 with Fluid Compute enabled; deployment-bound runtime attestation code is independently approved P0/P1/P2=0.
  - Provider-contract attestation code is independently approved P0/P1/P2=0, but no receipt/call exists without the Monid key and exact configuration.
  - Security re-review returned APPROVE P0=0/P1=0; both P2 recommendations are implemented and tested.
  - Current regression gate is 39 files/391 tests passed with 3 files/7 tests skipped; build 10 steps/4 workflows/13 pages; local E2E 14/2; fixtures 3/3.
  - Production dependency audit has no known vulnerabilities; full audit has zero high/critical findings with one low and three moderate development-chain findings.
  - The paid live verifier exists and received an independent PASS with P0=0/P1=0; its paid path has never been executed.
  - Application commit 936041e8ca1ed626978ee8750ba640ef4975c4d9 is pushed, deployed, and passed remote read-only smoke 4/4.
  - Captured Vercel deployment dpl_EW9Bt6QLnhbMSwhEL5yY3AaJ64GE has a deployment-bound 300-second runtime receipt.
  - Railway Cron completed three consecutive scheduled maintenance cycles; independent review APPROVE P0/P1/P2=0 closed the scheduler-evidence P1.
open_blockers:
  - This evidence-only commit requires a new Vercel deployment-bound runtime receipt after push.
  - Vercel Fluid Compute is bounded at 300 seconds with 105/150/285-second deadlines and Monid concurrency 4, but still requires a real Monid benchmark.
  - Monid CLI has no active API key, so the paid contract spike and real cost/retention evidence cannot run.
  - No provider-contract receipt or provider call exists.
  - Production Turnstile is absent, so guest live mutations cannot be released.
  - Interactive in-app browser automation is unavailable; no full live mutation flow or production citation click-through evidence is captured.
evidence:
  - release-evidence/railway-storage-probe.md
  - release-evidence/railway-maintenance-cron.md
  - release-evidence/neon-concurrency-probe.md
  - release-evidence/deployment-summary.md
  - release-evidence/bidworx-pricing-2026-09-03.md
scheduled_refresh: S3/runtime/provider receipts on Sep 9 and Sep 10 at 12:00 MDT
truth_boundary: The public sample, private-storage contract probe, and Neon probes are partial release evidence only. They do not establish deployed end-to-end source cleanup, Monid readiness, provider retention, latency, cost, video, submission, or publication completion.
```
