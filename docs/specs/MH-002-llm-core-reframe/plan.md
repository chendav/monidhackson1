# Execution Plan

Task ID: MH-002

## Sequence

1. Initialize/inspect CodeGraph and preserve the current source baseline.
2. Review candidate Git content, record index evidence, commit and push baseline.
3. Navigate semantic paths through CodeGraph, verify relevant source, and write
   `improvement-plan.md` plus a bounded `reframing_review.md`.
4. Produce handoff; independent reviewer checks evidence and plan only.
5. Commit/push reviewed planning documents and verify remote head/index state.

## Dependencies

Index before architectural navigation; baseline before final migration plan;
handoff before independent final review. Product implementation stays paused.

## Ownership

Chief: index, Git, current context, plan and closure. Reframing worker: advisory
report only. Reviewer: read-only, no authorship of reviewed plan.

## Verification

CodeGraph status/query/call graph plus source inspection; staged diff and secret
path/content checks; Git remote SHA; task structural validation and plan review.
No full suite or paid run is necessary for this checkpoint/planning request.

## Recovery

Baseline is immutable Git history. Do not reset/clean user work or force push.
Future experiments use a separate branch and cache namespace; implementation
requires the user's resumption and a reviewed minimal experiment.
