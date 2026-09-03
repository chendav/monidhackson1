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
status: blocked-on-provider-and-deployment-credentials
```
