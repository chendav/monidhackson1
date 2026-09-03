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
status: deployed-fail-closed-monid-spike-passed-turnstile-open
confirmed_progress:
  - Public sample deployment is reachable at https://rfp-xray.vercel.app.
  - Landing, OpenAPI, and Edmonton sample returned HTTP 200 on 2026-09-03.
  - Health returned 503 not_ready, preserving the production fail-closed gate.
  - Remote read-only Playwright deployment smoke passed 4/4 without mutations or paid calls.
  - Active Neon reports nine public tables, nine migration rows, schema v9 marker; live concurrency including both 16-way dispatch-claim races passed 4/4.
  - Dedicated Railway private Bucket has a bound attestation through 2026-09-10 04:11:53 MDT; current S3 live and real Chromium production-Origin probes each passed 1/1.
  - Railway provides private S3-compatible storage plus one no-domain, zero-idle-instance maintenance Cron; it runs no RFP analysis worker.
  - Vercel project settings are Node 22 with Fluid Compute enabled; deployment-bound runtime attestation code is independently approved P0/P1/P2=0.
  - Provider-contract attestation code is independently approved P0/P1/P2=0; the Monid side is configured and live-probed, while the exact deployment/OpenAI-bound receipt remains open.
  - Security re-review returned APPROVE P0=0/P1=0; both P2 recommendations are implemented and tested.
  - Current regression gate is 44 files/423 tests passed with 4 files/10 tests skipped; build 8 steps/4 workflows/13 pages; local E2E 14/2; fixtures 3/3. The opt-in paid Monid/Railway probe separately passed 1/1; the live Neon suite passed 4/4 on schema v9.
  - Production dependency audit has no known vulnerabilities; full audit has zero high/critical findings with one low and three moderate development-chain findings.
  - The paid live verifier exists and received an independent PASS with P0=0/P1=0; its paid path has never been executed.
  - Application commit fbb48d09bda4f8d671f6b1679c66d3e0400f45db and release commit 76e0f4e01f93d67eab4da9b98807959b81578396 are pushed; CI run 33793276409 passed and the current production release passed remote read-only smoke 4/4.
  - Local candidate 120e38a25824e083cce54470d9e27b17ff06844a prevents hard-kill replacement workers from duplicating an armed package cleanup watchdog; independent delta review APPROVE P0=0/P1=0. It is intentionally not pushed until the Turnstile release can ship once.
  - Local video scaffold fc054660aab99dbb46128a7d519bf1885f43ad5a defines the truthful 90-second sequence and an independently approved evidence gate; all canonical build/render/publish commands currently stop on 23 unresolved live markers.
  - Captured Vercel deployment dpl_5dMrPWKGMCKxy5hcQUfq57uLmZce has deployment-bound 300-second runtime and Monid/OpenAI provider-contract receipts.
  - Railway Cron completed seven consecutive scheduled maintenance cycles across more than 30 minutes; independent review APPROVE P0/P1/P2=0 closed the scheduler-evidence P1.
  - The analysis Workflow ACK-loss fence is implemented, focused-tested, and independently approved with P0=0, P1=0, and P2=0.
  - The generated-function envelope is 24 invocations and the conservative five-document full reserve is USD 1.412123; this is not a live provider receipt.
  - Schema-v9 migration is applied to production and the new live CAS probes passed 4/4.
  - The intended Monid workspace is authenticated and the exact context.dev /parse configuration is stored as Vercel environment values/secrets.
  - Credentialed discover/inspect pinned the canonical schema hash; two Edmonton parses succeeded at USD 0.0009 each.
  - Context.dev fetched a five-minute Railway signed URL, returned byte-identical Markdown, and application-controlled cleanup/absence was confirmed in 8.140 seconds.
  - Context.dev ZDR is unavailable for this workspace and its response reported a seven-day upstream artifact expiry; the candidate now discloses this before submission and in Audit & Cost.
  - Monid emitted no physical-page boundary signals, so the PDF.js index remains the only citation-page authority.
open_blockers:
  - Vercel Fluid Compute is bounded at 300 seconds with 105/150/285-second deadlines and Monid concurrency 4; one parse passed, but the ten-run Edmonton/CER campaign remains required.
  - Production Turnstile is absent, so guest live mutations cannot be released.
  - Cloudflare is authenticated and widget creation is authorized, but Windows browser control stopped before every page action because it could not verify Chrome's URL; no key was created or handled.
  - Turnstile configuration will require one new exact deployment and refreshed attestations; paid Edmonton/CER campaigns, 12 production citation clicks, final video, contest submission, and five social publications remain open.
  - No full live mutation flow or production citation click-through evidence is captured.
evidence:
  - release-evidence/railway-storage-probe.md
  - release-evidence/railway-maintenance-cron.md
  - release-evidence/neon-concurrency-probe.md
  - release-evidence/deployment-summary.md
  - release-evidence/bidworx-pricing-2026-09-03.md
  - release-evidence/monid-contract-spike-2026-09-03.md
scheduled_refresh: S3/runtime/provider receipts on Sep 9 and Sep 10 at 12:00 MDT
truth_boundary: The public sample, private-storage contract probe, and Neon probes are partial release evidence only. They do not establish deployed end-to-end source cleanup, Monid readiness, provider retention, latency, cost, video, submission, or publication completion.
```
