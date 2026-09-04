# Execution Plan

Task ID: MH-001

## Sequence

1. Treat the completed foundation, baseline implementation, and historical
   release evidence as inputs rather than current acceptance.
2. Complete T4 as a bounded redesign: one shared submission-channel classifier
   with separate publication and ambiguity decisions.
3. Produce the T4 backend handoff and run focused plus full local verification.
4. Start QA2 only after that handoff exists. The Reviewer returns exactly
   `PASS`, `REQUEST_CHANGES`, or `BLOCKED`.
5. On QA2 `PASS`, commit and deploy the accepted candidate once, then refresh
   deployment-bound checks and require healthy production dependencies.
6. Run a controlled Edmonton analysis and require READY plus the golden facts;
   only then run the CER main-plus-three-amendment campaign.
7. Complete the 12-citation independent review, truthful 90-second video,
   contest submission, and five required publications.

## Dependencies

- T1-T3, QA1, and REV-1 are completed historical phases.
- T4 depends on the T2 baseline, not on completion of the external campaign.
- QA2 depends on a complete T4 handoff and must not start earlier.
- EXT-1 resumes only after QA2 returns `PASS`.

## Ownership

- Chief: governance, sequencing, evidence boundaries, release, and knowledge disposition.
- T4 Backend: only the declared analysis classifier/recovery files and focused tests.
- Frontend: no active assignment in this phase.
- QA2 Reviewer: read-only independent evaluation after the T4 handoff.

## Verification

- T4 focused source-anchor/materialization tests, official Edmonton audit, then
  the full lint/typecheck/unit/integration/golden/build/Playwright gate.
- Live provider work starts only after QA2 `PASS`; never print secrets or raw
  tender content.
- Reviewer verifies acceptance IDs locally and at least 12 critical citations
  in the accepted production build.

## Recovery

- All jobs are idempotent and checkpointed; cleanup retries fail closed.
- Preserve the last buildable commit and use additive database migrations.
- Omit optional polish before weakening cleanup, citations, or golden correctness.
- The exhausted legacy review loop is not extended. If the bounded redesign
  cannot pass, record `BLOCKED` or request an architectural/human decision.
