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
status: completed_not_accepted_revision_loop_exhausted
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
status: completed_request_changes_redesign_required
```

## T5 Submission relation ambiguity redesign

```yaml
id: T5
owner_profile: backend
objective: Replace surface-form completeness assumptions with a conservative unresolved-evidence ambiguity fence so parser uncertainty cannot prove a different submission channel unique.
depends_on: [QA2]
include_paths: [src/lib/analysis/submission-channel.ts, src/lib/analysis/source-anchors.ts, src/lib/analysis/materialize.ts, tests/unit/closed-template-recovery.test.ts, tests/unit/core-field-recovery-materialize.test.ts, tests/unit/summary-recovery.test.ts, tests/unit/materialize-reconciliation.test.ts]
exclude_paths: [src/app/**, src/components/**, drizzle/**, docs/agent_knowledge/**]
edits_allowed: true
acceptance: [AC-4, AC-5, AC-10]
handoff: handoff-backend.md
status: completed_not_accepted_architectural_failure
```

## QA3 Submission relation redesign review

```yaml
id: QA3
owner_profile: reviewer
objective: Independently verify T5 publication, possibility, prohibition, and unresolved-evidence semantics plus all Edmonton regressions.
depends_on: [T5]
include_paths: [src/lib/analysis/**, tests/golden/official-fixture-audit.test.ts, tests/unit/closed-template-recovery.test.ts, tests/unit/core-field-recovery-materialize.test.ts, tests/unit/summary-recovery.test.ts, tests/unit/materialize-reconciliation.test.ts]
exclude_paths: []
edits_allowed: false
acceptance: [AC-4, AC-5, AC-10, AC-11]
handoff: qa_report.md
status: completed_request_changes
```

## T6 Agent-semantic submission adjudication

```yaml
id: T6
owner_profile: backend
objective: Replace deterministic English relation parsing with Agent adjudication over a complete high-recall source candidate ledger while keeping citation, coverage, conflict, and publication gates deterministic.
depends_on: [QA3]
include_paths: [src/lib/analysis/**, src/lib/providers/**, src/lib/evidence/**, src/lib/pipeline.ts, tests/unit/**, tests/integration/**, tests/golden/**]
exclude_paths: [src/app/page.tsx, src/components/**, src/app/globals.css, drizzle/**, docs/agent_knowledge/**]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_not_accepted_review_exhausted
```

## QA4 Agent-semantic review

```yaml
id: QA4
owner_profile: reviewer
objective: Independently verify candidate completeness, Agent adjudication, deterministic quote/page coverage, disagreement handling, cost bounds, and final publication safety.
depends_on: [T6]
include_paths: [src/lib/analysis/**, src/lib/providers/**, src/lib/evidence/**, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_request_changes_exhausted
```

## T7 Record-bound Agent semantic authority

```yaml
id: T7
owner_profile: backend
objective: Bind every model-authored public evidence record to an inline Agent submission-relevance decision and verified private relations so Draft output cannot bypass submission authority through an arbitrary collection or vocabulary.
depends_on: [QA4]
include_paths: [src/lib/analysis/**, src/lib/providers/**, src/lib/evidence/**, src/lib/pipeline.ts, tests/unit/**, tests/integration/**, tests/golden/**]
exclude_paths: [src/app/page.tsx, src/components/**, src/app/globals.css, drizzle/**, docs/agent_knowledge/**]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
```

## QA5 Record-bound authority review

```yaml
id: QA5
owner_profile: reviewer
objective: Independently verify one-to-one semantic annotation for every model record, relation/citation binding, collection-independent veto, and all prior T6 regressions.
depends_on: [T7]
include_paths: [src/lib/analysis/**, src/lib/providers/**, src/lib/evidence/**, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_approve
```

## T9 Source-ledger package authority

```yaml
id: T9
owner_profile: backend
objective: Make the complete all-page source ledger own package submission safety while record authority gates only publication and exact-source ledger disagreements.
depends_on: [QA6]
include_paths: [src/lib/analysis/record-authority.ts, src/lib/analysis/materialize.ts, src/lib/runs/record-authority-audit.ts, scripts/read-record-authority-audit.mjs, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/app/**, src/components/**, drizzle/**]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
```

## QA7 T9 source-ledger authority review

```yaml
id: QA7
owner_profile: reviewer
objective: Independently verify all-page ledger ownership, invented-record DoS resistance, exact-source gap vetoes, receipt v3 compatibility, and diagnostic redaction.
depends_on: [T9]
include_paths: [src/lib/analysis/**, src/lib/runs/record-authority-audit.ts, scripts/read-record-authority-audit.mjs, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_approve
```

## EXT-1 Production evidence and publication

```yaml
id: EXT-1
owner_profile: chief
objective: Verify the accepted build with controlled production runs, citations, cost, latency, video, contest submission, and publication evidence.
depends_on: [QA5]
include_paths: [docs/specs/MH-001-rfp-xray/**, videos/rfp-xray-launch/**]
exclude_paths: [src/**, tests/**, drizzle/**]
edits_allowed: true
acceptance: [AC-3, AC-4, AC-5, AC-6, AC-8, AC-9, AC-10, AC-11]
handoff: handoff.md
status: in_progress
confirmed_partial_evidence:
  - Production health is HTTP 200 and reports the database, storage, Workflow, Monid, and OpenAI gates ready.
  - The last controlled Edmonton run ended partial, cost USD 1.020701, and completed app-controlled cleanup.
open_gates:
  - A new controlled Edmonton run that reaches READY and passes the golden facts.
  - The CER main-plus-three-amendment production campaign.
  - Independent click-through of at least 12 high-risk production citations.
  - Final 90-second video, contest submission, and five required publications.
truth_boundary: Healthy components and a partial run do not establish final product or contest completion.
```

## T8 Publication/submission authority separation

```yaml
id: T8
owner_profile: backend
objective: Separate discarded non-submission model records from package submission safety without weakening unfamiliar-channel, citation, mapping, taint, or Q&A vetoes.
depends_on: [QA5]
include_paths: [src/lib/analysis/record-authority.ts, src/lib/analysis/materialize.ts, src/lib/runs/record-authority-audit.ts, src/lib/providers/openai.ts, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/app/**, src/components/**, drizzle/**]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
```

## QA6 T8 production-reframe review

```yaml
id: QA6
owner_profile: reviewer
objective: Independently falsify the publication/submission state split and confirm no weakening of SecureDrop, prompt-taint, mapping, citation, Q&A, or budget gates.
depends_on: [T8]
include_paths: [src/lib/analysis/**, src/lib/providers/**, src/lib/runs/record-authority-audit.ts, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_approve
```
