# Tasks

## T1 Shared foundation

```yaml
id: T1
owner_profile: chief
objective: Freeze provider facts, public contracts, fixtures, privacy wording, and ownership boundaries.
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
status: completed_baseline
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
status: completed_baseline
```

## QA1 Baseline independent review

```yaml
id: QA1
owner_profile: reviewer
objective: Independently verify the baseline implementation against acceptance criteria and regressions.
depends_on: [T2, T3]
include_paths: [src/**, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_historical
```

## REV-1 Baseline release blockers

```yaml
id: REV-1
owner_profile: chief
objective: Coordinate resolution of the baseline independent review findings without broadening product scope.
depends_on: [QA1]
include_paths: [src/**, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: []
edits_allowed: true
acceptance: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11]
handoff: handoff.md
status: completed_historical
```

Historical implementation and review evidence for T1-T3, QA1, and REV-1 remains
in the role-specific handoffs and `release-evidence/`. Those records retain
their original wording and are not current task status.

## T4 Edmonton core-field classifier redesign

```yaml
id: T4
owner_profile: backend
objective: Complete deterministic Edmonton core-field recovery with one shared submission-channel classifier that distinguishes publishable evidence from possible ambiguity.
depends_on: [T2]
include_paths: [src/lib/analysis/source-anchors.ts, src/lib/analysis/materialize.ts, src/lib/analysis/submission-channel.ts, tests/golden/official-fixture-audit.test.ts, tests/unit/closed-template-recovery.test.ts, tests/unit/core-field-recovery-materialize.test.ts]
exclude_paths: [src/app/**, src/components/**, drizzle/**, docs/agent_knowledge/**]
edits_allowed: true
acceptance: [AC-4, AC-5, AC-10]
handoff: handoff-backend.md
status: in_progress
```

## QA2 Edmonton redesign review

```yaml
id: QA2
owner_profile: reviewer
objective: Independently verify T4, official Edmonton facts, submission-channel ambiguity semantics, and affected regressions.
depends_on: [T4]
include_paths: [src/lib/analysis/**, tests/golden/official-fixture-audit.test.ts, tests/unit/closed-template-recovery.test.ts, tests/unit/core-field-recovery-materialize.test.ts]
exclude_paths: []
edits_allowed: false
acceptance: [AC-4, AC-5, AC-10, AC-11]
handoff: qa_report.md
status: pending_waiting_for_T4_handoff
```

## EXT-1 Production evidence and publication

```yaml
id: EXT-1
owner_profile: chief
objective: Verify the accepted build with controlled production runs, citations, cost, latency, video, contest submission, and publication evidence.
depends_on: [QA2]
include_paths: [docs/specs/MH-001-rfp-xray/**, videos/rfp-xray-launch/**]
exclude_paths: [src/**, tests/**, drizzle/**]
edits_allowed: true
acceptance: [AC-3, AC-4, AC-5, AC-6, AC-8, AC-9, AC-10, AC-11]
handoff: handoff.md
status: waiting_for_QA2
confirmed_partial_evidence:
  - Production health is HTTP 200 and reports the database, storage, Workflow, Monid, and OpenAI gates ready.
  - The last controlled Edmonton run ended partial, cost USD 1.020701, and completed app-controlled cleanup.
open_gates:
  - Accepted T4 implementation and independent QA2 PASS.
  - A new controlled Edmonton run that reaches READY and passes the golden facts.
  - The CER main-plus-three-amendment production campaign.
  - Independent click-through of at least 12 high-risk production citations.
  - Final 90-second video, contest submission, and five required publications.
truth_boundary: Healthy components and a partial run do not establish final product or contest completion.
```
