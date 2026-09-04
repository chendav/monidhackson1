# Current Task Brief

- Task ID: MH-001
- Title: RFP X-Ray contest MVP
- Status: active; T12 production evidence failed the core gate and T13 is the
  only authorized implementation before independent QA11
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

Implement T13's delivery-domain coverage definition and relation-relative
condition object while preserving canonical ownership and every current veto;
run the falsification matrix and full local gates, then obtain independent
QA11. Only after QA11 PASS may the Chief deploy and authorize one controlled
Edmonton pilot. A full golden pass remains required before the CER campaign.

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
