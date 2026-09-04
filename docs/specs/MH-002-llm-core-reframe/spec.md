# Indexed baseline and LLM-only core redesign

Task ID: MH-002

## Outcome

Preserve current work in Git, build a local CodeGraph index and reproducible
index record, then deliver a source-backed improvement plan. No refactor yet.

## Background

The user stopped prolonged patching and requires LLMs for all document semantics.
The current implementation mixes model extraction, lexical semantic validators,
global authority gates and keyword-based Q&A. The baseline is not a release.

## In Scope

- CodeGraph initialization, freshness/coverage inspection and navigation record.
- Preserve prior dirty work; inspect publication hygiene; commit/push to origin.
- Source-backed reframing, phased improvement plan and independent review.

## Out of Scope

- Product code changes, migrations, deployment, paid model/parser tests, videos.
- Removing privacy/security controls or silently extending content retention.

## Constraints

- Follow AGENTS.md and the user's LLM-only semantic boundary.
- No raw tender PDFs, provider responses, credentials or signed URLs in Git.
- Keep CodeGraph's machine-local database ignored; version rebuild instructions
  and an index/source inventory instead.
- Preserve existing changes and report incomplete baseline checks accurately.

## Acceptance Criteria

- AC-1: CodeGraph initialized; status and source inventory recorded; no pending
  indexed-file changes at handoff; at least one call path checked against source.
- AC-2: Baseline committed and pushed without force; remote SHA verified;
  candidate content inspected for sensitive/unwanted files.
- AC-3: Plan lists concrete replacement/retention boundaries, minimum data model,
  Q&A evidence lifecycle, phased tasks, experiments, verification and rollback.
- AC-4: Independent Reviewer approves the delivered index/plan evidence while
  explicitly distinguishing it from product implementation/release acceptance.

## Risks and Unknowns

CodeGraph is static and does not index every file type. T27 is an unfinished
checkpoint. Full-document Q&A retention and new prompt quality need future
validation; no such validation is claimed by this task.
