# Execution Plan

Task ID: MH-001

## Sequence

1. Treat the completed foundation, baseline implementation, and historical
   release evidence as inputs rather than current acceptance.
2. Preserve T4/QA2 and T5/QA3 as unaccepted evidence; do not extend the
   deterministic English-parser route.
3. Complete the current bounded task with saved, hash-bound fixtures and focused
   module tests; do not reparse an official document or rerun the entire suite
   after each edit.
4. Produce its handoff and start independent QA only after focused checks pass.
5. On independent QA `PASS`, run the full local gate once, commit and deploy the
   accepted candidate once, then refresh
   deployment-bound checks and require healthy production dependencies.
6. Run a controlled Edmonton analysis and require READY plus the golden facts;
   only then run the CER main-plus-three-amendment campaign.
7. Complete the 12-citation independent review, truthful 90-second video,
   contest submission, and five required publications.

## Dependencies

- T1-T3, QA1, and REV-1 are completed historical phases.
- T4/QA2 and T5/QA3 are completed but unaccepted design evidence.
- T13 depends on the T12 production falsification; QA11 depends on a complete
  T13 handoff.
- EXT-1 paid execution resumes only after QA11 returns `PASS`.

## Ownership

- Chief: governance, sequencing, evidence boundaries, release, and knowledge disposition.
- T13 Backend: declared provider/submission files and bounded tests only.
- Frontend: no active assignment in this phase.
- QA11 Reviewer: read-only independent evaluation after the T13 handoff.

## Verification

- Level 1 iteration: unit tests for only the changed module, using small
  synthetic counterexamples and saved provider-response shapes. Run freely.
- Level 2 task gate: the affected Edmonton/CER golden fixtures, using the saved
  local official PDFs and deterministic page indexes. Run once after focused
  tests are stable; no Monid/OpenAI call.
- Level 3 release-candidate gate: full lint/typecheck/unit/integration/golden,
  build, and Playwright. Run once before independent acceptance/deployment, and
  again only if Reviewer-requested code changes invalidate it.
- Level 4 production proof: after independent PASS and exact-deployment
  attestation, require the reviewed repository deterministic regression manifest at
  10/10, one accepted Edmonton production run, and one accepted shuffled CER
  production run. Record the two live latencies only as point-in-time
  observations. The former ten-Edmonton-plus-one-CER paid campaign is an
  explicit opt-in benchmark, never a default release condition.
- Reuse `.data/official-fixtures/` and ignored `.data/` regression receipts. Every
  cached artifact must record source SHA-256, schema/prompt/wire versions, and
  generation provenance; a mismatch invalidates the cache. Never commit raw
  PDFs, page text, Markdown, provider bodies, signed URLs, or credentials.
- Never use a full production run to debug a module when a redacted audit plus a
  deterministic local regression can falsify it.
- Reviewer verifies acceptance IDs locally and at least 12 critical citations
  in the accepted production build.

## Recovery

- All jobs are idempotent and checkpointed; cleanup retries fail closed.
- Preserve the last buildable commit and use additive database migrations.
- Omit optional polish before weakening cleanup, citations, or golden correctness.
- T13 is the final submission-field redesign. If its single controlled
  production proof still cannot resolve the field, publish `needs_review` with
  verified evidence and continue the broader product release instead of opening
  another architecture loop.
