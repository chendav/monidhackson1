# Current Task Brief

## Active request — MH-002 baseline and LLM-only redesign plan

The user paused product implementation and paid tests, then authorized CodeGraph
indexing, a Git baseline commit/push, and an improvement plan. This section
supersedes all historical continuation instructions below. Do not resume MH-001
fixes, deployments, provider calls, or publication. Root owns index/Git/plan;
a bounded read-only reframing worker advises, followed by independent review.
Acceptance and current progress: `docs/specs/MH-002-llm-core-reframe/`.
Required direction: LLM-only document semantics; deterministic code only for
provenance, structure, calculations, access, lifecycle, and accounting.

## Current real CER finding — receipt capacity, not quote guessing

T26 captured all4 genuine Monid artifacts and all5 genuine v8 model batches.
Model168503input/41149output tokens (estimateUSD0.311548), MonidactualUSD0.0036.
The saved result is empty because verifyRecordAuthorities replaced its manifest
with unresolvedRecordAuthority(record_authority_receipt_capacity):256KiB limit.
There are216candidate records and188true physical receipts. Do NOT rerun paid
providers. Next: measure the pre-capacity serialized receipt from offline replay,
inspect every downstream bound, and test a bounded capacity/representation fix.
No source-semantic gate relaxation is justified by this size failure.
Offline capacity experiment measured269326bytes and restored156verified records,
32requirements and correct50/94+70/30 evaluation without new calls. T27 proposes
bounded524288 cap plus historical audit compatibility (v5 new/v1-v4 preserved).
See t27-reframing.md; independent hypothesis review before implementation.
Reviewer accepts the capacity hypothesis with one scope correction: include
audit CLI/direct tests, preserving old caps and accepting v5 explicitly. Chief
accepts corrected scope; authority_fix implements, independent review next.

## Current next action — T25 implementation review

T25 is implemented and independently PASS (P0/P1=0), with 152 focused tests. Root's actual
zero-network derived v7-to-v8 replay preserves all facts/classifications, deletes
only citation f, and exercises the real adapter/authority/materializer. Verified
authority grows 32 to82; public requirements16 to32; all7 existing Edmonton
golden checks pass. Full check846 passed/12 designed skips and build PASS. Public production remains fc85c24.
Keep the public budget controls; the user's development daily-cap waiver applies
to isolated diagnostic work. Reuse retained sources/responses before any new call.

Checkpoint the reviewed citation milestone. T26 prepares a real CER/Monid cache capture so any later defect can be
replayed locally; do not return to uncached full production retries.
Official source HTTP403 occurred before any paid T26 dispatch. Use pinned cached
PDFs through existing private signed-source storage, with finally deletion and
Head404 receipts; independent Reviewer checks this bounded delta before capture.

## Authoritative continuation — T25 batch evidence ownership

T25 hypothesis and minimum offline experiment are now independently ACCEPTED.

The existing seven-rule Edmonton golden function directly PASSES the T24 local
result; remaining citation completeness and production/CER evidence must not be
misreported as a failure of those seven specific checks. Keep these gates separate.
The conservative same-request-origin prototype uniquely binds107/120 citations
versus41/120; all old41 remain, absent/ambiguous cohorts gain0. Next: implement
the v8 server-owned origin resolver, then use the saved v7 fixture with only f
removed to test the real authority/materialization path. No further model call.
See `t25-reframing.md` for scope and provenance invariants. `authority_fix` is
assigned the bounded v8 implementation. Root prepares the derived cached-fixture
replay independently; `authority_review` reviews only after implementation handoff.

T24 and its whitespace-only delta passed independent QA (145 focused tests,
typecheck; fixed release selections now include 90 authority +55 adapter tests).
The full cached Edmonton PDF.js/OpenAI component capture took 94.68s and produced
13 claims/16 requirements, correct p14 selection and p43 M1–M4, plus security and
Annex D/E facts. The existing seven-rule local golden passes; this is not comprehensive production acceptance. All four real model
responses are cached for zero-network replay; no more paid call is needed now.

Offline attribution of 120 raw citations found 44 whose quote is in a different
fragment of the same batch; 26 whose quote is outside that batch's source
fragments but present in that same request's submission coverage windows. The
two input representations have different ownership partitions. T25 is read-only
reframing of evidence ownership and an offline falsification experiment; no new
production changes or deployment until accepted. Preserve actual issued scope,
document identity, unique physical occurrence, raw evidence and semantic gates.

## Authoritative continuation — T24 source-quote citations

T24 initial implementation passed independent QA and 138 focused tests. One v7
capture completed in 11.86s (model estimate USD 0.012156): 9/11 quotes matched
raw source; 2 differed only in line-wrap placement. All 11 have one unique
whitespace-equivalent occurrence, proven from the saved response without another
call. Reviewer ACCEPT permits a representation-only delta: collapse nonempty
whitespace runs for matching, preserve every non-whitespace UTF-16 unit, require
uniqueness across that whole equivalence domain, map back to raw source offsets,
keep the raw-span 500-unit cap and all downstream checks. No other normalization.
This supersedes the earlier raw-whitespace restriction only; no more paid call.

T23 captured a real Edmonton p14 response in 13.87s (3,787 input / 1,985 output
tokens; estimated model cost USD 0.011773). It proves the model's UTF-16 offsets
can select unrelated text: `Canada` selected `th the`. The excerpt's incomplete
ledger prevented downstream publication, so complete CER causality is unproven.
Independent Reviewer ACCEPT permits T24: replace private record citation f/a/n/s
with f/q/s, where q is an exact bounded source quote; the server uniquely locates
it and retains the existing physical verification. No fuzzy repair, new model
pass, or changes to submission relation offsets. Test only the affected boundary
and cached response first; no deployment or full paid package retry yet.

## Authoritative continuation — T23 local failure capture

T22 is committed at `fc85c24b3b794126e3ca5c62d11483894acb97d7`, deployed as
`dpl_6aqbQYGu844UDpViH1L4xW4LKouk`, and independently approved. Its clean
deterministic receipt passed 10/10 and deployment attestations/health/smoke
passed. The single CER proof nevertheless ended `partial`: 74 model records
passed authority, 131 citations were exact, and every public collection was
empty. Source cleanup succeeded; conservative cost was USD 1.198689.

Repeated materialization failure triggers reframing. T23 prepares an ignored,
local, saved-PDF excerpt harness that captures an actual provider response and
decoded draft, then supports zero-provider-call replay with rejection tracing.
No production heuristic or same-candidate retry is authorized. One local model
batch up to USD 0.25 may be executed after independent experiment review;
the user's development budget waiver and document-caching instruction apply.

## Authoritative release continuation — T21

This section supersedes T20 and older current-state text below.

- T22 is complete and QA20 PASS (P0=0/P1=0): the fixed release selection now
  includes all 81 record-authority tests, including 19 T21 cases. The remaining
  release step is to commit, deploy, and collect current-candidate evidence.
- QA19 Revision 2 passed with P0=0/P1=0 after closing contextual projection
  provenance and stale Edmonton packing-fixture findings. The next gate is an
  atomic candidate commit and immutable deployment, not more extraction tuning.
- The preceding T20 commit `55c2e04cc2e71252513d90db4e5e066fcb8b5e43` was deployed as
  `dpl_EK7UXxWdvC6BbuMqCm7EbSz7Pkvg`; runtime/provider attestations, exact
  health, public smoke 4/4, and saved-fixture regression 10/10 passed.
- Its single authorized shuffled CER run ended `partial` after 217,413 ms and
  USD 1.187588 conservative cost. All four Monid parses, five OpenAI batches,
  and controlled source cleanup succeeded. No retry occurred.
- T20 materially improved record authority: verified publication rose from
  43/195 to 101/186, source-unlocated fell from 106 to 59, and relation-gap
  fell from 41 to 16. Materialization nevertheless removed every model record,
  leaving zero requirements and zero evaluation fields.
- Offline falsification proves selector-bound Markdown presentation can pass
  physical authority while typed solicitation/evaluation values fail later
  deterministic presentation/field comparisons. A second semantic model call
  is rejected as unnecessary and unable to repair this deterministic bug.
- T21 implements only selector-authenticated, ephemeral presentation
  projection plus removal of summary-field routing from non-Claim records.
  Public evidence remains the byte-exact PDF.js quote. No fuzzy matching,
  number repair, extra provider call, retry, or persisted source body is in
  scope.
- The release automation remains PAUSED. No paid run is authorized before T21
  implementation, full local gates, independent QA19 PASS, immutable deploy,
  fresh attestations, and health/smoke.

## Authoritative release continuation — T20

This section supersedes T19 and older current-state text below.

- Candidate base commit: `55baeb8bdcf1e019493538a04efc32c1a197a09d`.
- One controlled shuffled CER run on deployment
  `dpl_8b19zqRuYxcEAkJPoW33UyxZtsLC` ended `partial` after 206,895 ms and
  USD 1.193860 conservative cost. All four Monid parses, five OpenAI batches,
  and source cleanup succeeded. No retry occurred.
- The retained audit isolated two product defects: submission-category facts
  were incorrectly treated as whole-bid delivery channels, and exact Monid
  selectors could not safely ignore bounded Markdown presentation markers.
- T20 narrows relevance to atomic whole-bid channel facts, aligns the `n`
  cross-check to concrete channels, and adds fail-closed ATX/strong-emphasis
  alignment. It does not add fuzzy matching or normalize source numbers.
- The saved official Amendment 001 genuinely contains conflicting solicitation
  values (`84084-26-009/A` on p1 and `84084-26-0006/A` on p2-p6). The conflict
  remains source truth; it may withhold the package submission channel but does
  not force terminal `partial` when substantive minimum coverage is present.
- QA18 returned `PASS`, P0=0/P1=0/P2=0. The final local gate passed 809 tests
  with 12 designed skips, lint, and production build. Deployment and exactly
  one paid CER proof are authorized after immutable deployment attestations,
  health/smoke, and budget admission. Automatic retry remains forbidden.
- Development daily cap is temporarily USD 26.25 under explicit user
  authorization; the per-run reservation remains USD 2.

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
