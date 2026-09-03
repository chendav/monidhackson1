# Chief Agent Task Schema

Use one directory per medium, large, risky, or cross-component task:

```text
docs/specs/<task-id>-<slug>/
├─ spec.md
├─ plan.md
├─ tasks.md
├─ agent_routing.yaml
├─ qa_gate.yaml
├─ handoff.md
└─ qa_report.md
```

## Required Contracts

- `spec.md`: outcome, scope, exclusions, constraints, acceptance IDs, risks.
- `plan.md`: sequence, dependencies, ownership, verification, recovery.
- `tasks.md`: bounded assignments with include/exclude paths and edit authority.
- `agent_routing.yaml`: Chief, implementers, independent Reviewer, sequencing.
- `qa_gate.yaml`: required acceptance and regression checks, three-round limit.
- `handoff.md`: changed files, evidence, assumptions, tests, risks, follow-ups,
  and proposed long-term knowledge.
- `qa_report.md`: independent verdict and criterion-level evidence.

Use `PASS`, `REQUEST_CHANGES`, or `BLOCKED` as Reviewer verdicts. Never represent
missing evidence as a pass.
