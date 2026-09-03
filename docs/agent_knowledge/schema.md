# Knowledge Entry Schema

Store one Markdown file per canonical entry under `docs/agent_knowledge/entries/`.

Required front matter:

```yaml
id: K-001
kind: fact
status: active
authority: reviewed_task_evidence
profiles: [backend]
source_path: docs/specs/T-001-example/handoff.md
source_locator: Confirmed
source_hash: sha256:...
reviewer_verdict: PASS
reviewed_at: 2026-01-01
sensitive: false
```

The body must contain one reusable claim, its scope, evidence boundary, known
conflicts, and supersession information. Do not store secrets, raw private
conversation, chain-of-thought, or unbounded command output.
