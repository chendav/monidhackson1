# Tasks

## T1 — Index and baseline

```yaml
id: T1
owner_profile: chief
objective: Initialize CodeGraph and safely commit/push the current baseline.
depends_on: []
include_paths: [.codegraph, docs/specs/MH-002-llm-core-reframe, docs/agent_context]
exclude_paths: [.env*, .data, node_modules]
edits_allowed: true
acceptance: [AC-1, AC-2]
handoff: handoff.md
status: completed
```

## T2 — Reframing and plan

```yaml
id: T2
owner_profile: reframing
objective: Advise on minimum LLM-only semantic pipeline using CodeGraph and source.
depends_on: []
include_paths: [src/lib/analysis, src/lib/providers/openai.ts, src/lib/pipeline.ts, src/contracts, src/app/api/v1/runs, docs/specs/MH-002-llm-core-reframe]
exclude_paths: [.env*, .data, node_modules, production]
edits_allowed: true
acceptance: [AC-3]
handoff: reframing_review.md
status: completed
```

Only the advisory report may be edited by T2; product code is read-only.

## QA1 — Independent review

```yaml
id: QA1
owner_profile: reviewer
objective: Review index, publication hygiene and plan evidence, not product readiness.
depends_on: [T1, T2]
include_paths: [AGENTS.md, .codegraph, docs/specs/MH-002-llm-core-reframe, src]
exclude_paths: [.env*, .data, node_modules, production]
edits_allowed: false
acceptance: [AC-1, AC-2, AC-3, AC-4]
handoff: qa_report.md
status: completed
```
