# Tasks

## T1

```yaml
id: T1
owner_profile: implementer
objective: TODO
depends_on: []
include_paths: []
exclude_paths: []
edits_allowed: true
acceptance: [AC-1]
handoff: handoff.md
status: pending
```

## Review

```yaml
id: QA1
owner_profile: reviewer
objective: Independently verify the acceptance criteria and regressions.
depends_on: [T1]
include_paths: []
exclude_paths: []
edits_allowed: false
acceptance: [AC-1]
handoff: qa_report.md
status: pending
```
