# Execution Plan

Task ID: MH-001

## Sequence

1. Treat the completed foundation, baseline implementation, and historical
   release evidence as inputs rather than current acceptance.
2. Preserve T4/QA2 and T5/QA3 as unaccepted evidence; do not extend the
   deterministic English-parser route.
3. Complete T6 with high-recall deterministic candidate discovery, Agent
   semantic adjudication, exact quote/page coverage, and deterministic
   disagreement/unresolved resolution.
4. Produce the T6 handoff and start independent QA4 only after its checks exist.
5. On QA4 `PASS`, commit and deploy the accepted candidate once, then refresh
   deployment-bound checks and require healthy production dependencies.
6. Run a controlled Edmonton analysis and require READY plus the golden facts;
   only then run the CER main-plus-three-amendment campaign.
7. Complete the 12-citation independent review, truthful 90-second video,
   contest submission, and five required publications.

## Dependencies

- T1-T3, QA1, and REV-1 are completed historical phases.
- T4/QA2 and T5/QA3 are completed but unaccepted design evidence.
- T6 depends on QA3's architectural findings; QA4 depends on a complete T6
  handoff.
- EXT-1 resumes only after QA4 returns `PASS`.

## Ownership

- Chief: governance, sequencing, evidence boundaries, release, and knowledge disposition.
- T6 Backend: declared analysis/provider/evidence files and bounded tests only.
- Frontend: no active assignment in this phase.
- QA4 Reviewer: read-only independent evaluation after the T6 handoff.

## Verification

- T6 candidate-coverage/adjudication/materialization tests, official audit, then
  the full lint/typecheck/unit/integration/golden/build/Playwright gate.
- Live provider work starts only after QA2 `PASS`; never print secrets or raw
  tender content.
- Reviewer verifies acceptance IDs locally and at least 12 critical citations
  in the accepted production build.

## Recovery

- All jobs are idempotent and checkpointed; cleanup retries fail closed.
- Preserve the last buildable commit and use additive database migrations.
- Omit optional polish before weakening cleanup, citations, or golden correctness.
- Exhausted review loops are not extended. T6 is a new Agent-semantic redesign,
  not another deterministic parser patch; if it exhausts its review contract,
  redesign or request direction again.
