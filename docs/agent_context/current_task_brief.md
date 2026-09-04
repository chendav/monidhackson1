# Current Task Brief

## Authoritative release continuation — T19

This section supersedes older current-phase statements below wherever they
conflict. Historical diagnosis remains for provenance.

- Current `HEAD` and `origin/main`: `f84e92b2bb6be1de15aa9bb351aa9c742e73f508`.
- Current public deployment: `dpl_D7vxrruGA11tLACAahAGCyvVGm7s` at
  `https://rfp-xray.vercel.app`.
- Exact-deployment runtime/provider attestations, public health, and strict
  production smoke 4/4 passed. The release-candidate repository gate passed 60
  test files / 794 tests with 12 designed skips; saved-fixture deterministic
  CER regression passed 10/10.
- The authenticated retained-run fragment review path passed independent QA
  with P0=0/P1=0/P2=0. It adds no authorization and the API still enforces
  request authentication plus run ownership.
- The remaining core evidence is exactly one shuffled CER production run after
  the UTC budget reset, at least 12 verified UI citation disclosures, and then
  exactly one Edmonton production run using the saved PDF through signed PUT.
  Neither live run may be repeated automatically after failure.
- Daily production cap remains USD 23 and per-run cap remains USD 2. At
  2026-09-04 13:05 MDT, only USD 0.869684 remained in the current UTC window,
  so no paid run is admissible before the 18:00 MDT reset.
- The ignored release helpers are bound to the exact deployment and commit,
  store raw run IDs only in ignored local control files, and emit sanitized
  pass/fail evidence with hashed run identity. CER uses the four fixed official
  manifest URLs in order 003, base, 001, 002 and validates against saved local
  PDFs; Edmonton uses the saved PDF through signed PUT.
- QA17 Revision 2 returned `PASS` with P0=0/P1=0/P2=0 and permits deployment.
  The next action is one full local candidate gate, commit/push, immutable
  deployment, and fresh deployment-bound attestations before any paid run.

- Task ID: MH-001
- Title: RFP X-Ray contest MVP
- Historical status through T17: active; T15 commit `aa8d10d7d3930eb335734ee5fef7a5052d590806`
  is deployed, freshly attested, and proved all five CER extraction batches can
  complete within the unchanged provider budget. The retained production run
  ended `partial`: 190 model records were received, but record authority
  discarded 158, including 127 `source_unlocated`; the independent submission
  ledger verified 95/116 candidates and left 18 `semantic_uncertainty` plus
  three `ownership_mismatch`. T16 is a saved-artifact-only source-binding
  reframe. QA14 returned `REQUEST_CHANGES`, P0=0/P1=2/P2=1: unrestricted
  NFKC and loose pipe stripping can create false physical bindings, and v2
  authority does not re-resolve selector provenance after receipt mutation.
  T16 Revision 1 closed those findings and passed independent QA14 Revision 1
  with P0=0/P1=0/P2=0. The single release-candidate full check then found one
  stale integration fixture that still authors a legacy v1 authority envelope
  while expecting v2 publication. T16 Revision 2 migrated that fixture and
  passed independent QA14 Revision 2 with P0=0/P1=0/P2=0. The resumed release-
  candidate gate passed 777 tests, production build, and Playwright 14/14 with
  two credentialed storage tests skipped. Commit `64a1100591e6874569c1f64170007bd6a7444414`
  was deployed and attested as `dpl_EAa9iNpVEFQgYM1K5PaFKRbQ3hxS` with a
  USD 23 daily cap and unchanged USD 2 run cap. The one controlled CER proof
  completed all providers and cleanup but falsified T16: all 194 model records
  were `source_unlocated` because whole 10k Monid fragments did not align to
  the PDF.js document representation. T17 selector-scoped implementation passed
  its focused suite but QA15 found one P1: a selector can consume only part of a
  target compatibility glyph expansion (`f` or `i` binding raw `ﬁ`). T17
  Revision 1 closed that boundary and passed independent QA15 with P0=0/P1=0/
  P2=0. The one T17 release-candidate gate passed 780 tests, production build,
  and Playwright 14/14 with two credentialed storage cases skipped. Commit,
  exact deployment, attestations, and a later budget-admissible CER proof remain.
- Chief owner: chief
- Updated: 2026-09-04
- Active packet: `docs/specs/MH-001-rfp-xray/`

## Outcome

Ship an English public Web application and JSON API that converts a supplied
tender pack into a cited summary, mandatory requirements, evaluation rules,
risks, amendment reconciliation, grounded Q&A, cleanup evidence, and per-run
cost. The product is document-only and does not search for tenders.

## In Scope

- Next.js/TypeScript Web and API on Vercel, durable Workflow execution, Neon
  state, and Railway private temporary object storage plus bounded maintenance.
- Monid/context.dev parsing, OpenAI structured extraction, server-owned physical
  page citations, deterministic source-anchor recovery, and closed-document Q&A.
- Edmonton and CER golden evidence, cleanup/cost controls, production QA,
  independent review, demo evidence, contest submission, and required posts.
- Project orchestration through the repository Chief Agent mechanism.

## Out of Scope

- Tender search, bid writing, bidder-fit or win-probability claims.
- Team collaboration, CRM, SSO, billing, approval workflows, and long-term tender
  storage.
- A Railway analysis worker; Railway remains storage plus a short-lived
  maintenance trigger unless measured Vercel limits force an explicit redesign.

## Acceptance Criteria

- AC-1: URL/upload package limits and validation are enforced.
- AC-2: Closed-world processing records zero search/link/script/tool events.
- AC-3: READY is impossible until controlled source/intermediate cleanup succeeds.
- AC-4: Critical claims have verified SHA-bound physical-page citations.
- AC-5: Edmonton golden extraction and document-structure tests pass.
- AC-6: CER replacement, order-independence, and conflict tests pass.
- AC-7: Versioned API/OpenAPI and lifecycle operations match shared contracts.
- AC-8: The responsive English surface exposes all required result states.
- AC-9: Authentication, quota, budget, logging, and retention controls pass.
- AC-10: Lint, typecheck, tests, build, and Playwright pass.
- AC-11: An independent Reviewer returns `PASS` with P0=0 and P1=0.

## Current Phase

- `main` and `origin/main` are commit
  `40f425c596a1a91c216d49178ff61e065334b676`; production deployment
  `dpl_563oYhacTDPjn4XSSB3vT6DLF7zx` is live with schema v10 and fresh runtime
  and provider attestations.
- The last controlled Edmonton run reached `partial`, not READY. It cost
  USD 1.020701, completed controlled cleanup, and recovered requirements,
  security facts, M1-M4, and the Annex D/E conflict, but evaluation and several
  executive fields were absent.
- T7 record-bound Agent authority and its sanitized 30-day receipt audit passed
  independent QA5 Revision 3 with `APPROVE`, P0=0/P1=0/P2=0. Root reruns passed
  715 tests, official fixtures 3/3, production build, and Playwright 14/14.
- The post-deploy Edmonton run reached `ready` and cleaned sources, but failed
  the core gate because 25 discarded model citations made the global authority
  incomplete and suppressed an independent Email result. T8 addresses only
  that state-model coupling; no repeat paid run occurs before QA6 approval.
- T8 passed independent QA6 with `APPROVE`, P0=0/P1=0/P2=0. Root reruns passed
  721 tests, official fixtures 3/3, build, and Playwright 14/14. Deployment is
  authorized; a second controlled Edmonton run remains the production proof.
- The second production run also failed the Email core gate with only four
  rejected citations and a healthy 88865-byte receipt. T9 moves package safety
  to the complete all-page ledger, adds v3 diagnostic counters, and passed QA7
  with `APPROVE`, P0=0/P1=0/P2=0. Redeployment is authorized.
- The T9 production run reached `ready`, confirmed cleanup, and preserved every
  Edmonton golden other than submission method. Its 114-record v3 receipt was
  globally incomplete at 139271/262144 bytes. Static tracing proves that record
  receipt failure cannot itself null Email; the independent source-ledger
  adjudication was also incomplete or unresolved. V3 retained neither bounded
  initiating reason, so no further paid run is authorized before T10 and QA8.
- T10 now has independent QA8 `PASS`, P0=0/P1=0/P2=0. Root repeated 737/10
  full checks, official fixtures 3/3, build, and Playwright 14/14. The accepted
  private contract uses exact batch schemas, inline record relevance, and a
  separate redacted submission audit. Deployment is authorized, not release.

## Owners

- Chief: scope, sequencing, evidence boundaries, knowledge disposition, release.
- Backend implementer: bounded analysis and citation changes only.
- Frontend implementer: UI-owned paths only when a frontend delta is required.
- Independent Reviewer: final `PASS | REQUEST_CHANGES | BLOCKED` verdict; no
  implementation edits.

## Immediate Next Action

Commit and deploy the accepted T17 candidate, refresh exact runtime/provider
attestations and public health. Do not run another paid CER while today's fixed
USD 2 reservation would exceed the USD 23 daily cap; use the next budget window
for exactly one controlled proof.

## Verification Cadence

- During edits, run only focused module tests against synthetic and saved,
  hash-bound local fixtures.
- After the focused result stabilizes, run the affected official golden tests
  once without calling Monid or OpenAI.
- Run the full check/build/browser gate once per release candidate, not after
  every patch.
- Run a paid full-document production proof only after independent QA PASS.
- T13 is the final redesign for submission method; a remaining failure becomes
  a cited `needs_review` result and does not open another redesign loop.

## Continuation — T18 release-validation split

- T17 is independently accepted and deployed from commit
  `a15df0ea742fb7fd0964979a77762cb8d88a4ede` as exact deployment
  `dpl_5pcTuDzqbgV3VorKZuS8Rr6QEWDx`; runtime/provider attestations and public
  health passed.
- Ten focused, saved CER official-fixture regression runs passed 10/10 without
  Monid, OpenAI, network access, or paid work; this is repository-test evidence,
  not provider-shaped execution.
- Replace the obsolete eleven-paid-run release gate with separately auditable
  evidence classes: reviewed repository deterministic regression 10/10, live Edmonton 1/1, and shuffled
  live CER 1/1. Single live observations must not be labeled median, P95, or a
  provider-stability rate.
- T18 may change only the release verifier, its tests, and release documents.
  It must preserve the old eleven-run campaign as an opt-in benchmark, preserve
  every cleanup/citation/budget/attestation gate, and perform no provider calls.
- QA16 rejected exit-code-only attestation and the earlier provider-shaped
  artifact interpretation. Revision 1 therefore requires exact structured
  Vitest identities/counts, saved official PDF hashes, and candidate/config/
  dependency/runtime binding, without claiming retained provider intermediates.
