# Current Task Brief

- Task ID: MH-001
- Title: RFP X-Ray contest MVP
- Status: active; T7 is independently accepted and the release is entering
  migration, deployment, and controlled production validation
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

- `main` and `origin/main` include governance commit `2a5f8d9`; the working tree
  contains the uncommitted T6 Agent-semantic redesign.
- Production at `https://rfp-xray.vercel.app` is deliberately fail-closed because
  the old deployment's Workflow/provider attestations expired; database,
  storage, and maintenance remain ready. Refresh after the accepted deployment.
- The last controlled Edmonton run reached `partial`, not READY. It cost
  USD 1.020701, completed controlled cleanup, and recovered requirements,
  security facts, M1-M4, and the Annex D/E conflict, but evaluation and several
  executive fields were absent.
- T7 record-bound Agent authority and its sanitized 30-day receipt audit passed
  independent QA5 Revision 3 with `APPROVE`, P0=0/P1=0/P2=0. Root reruns passed
  715 tests, official fixtures 3/3, production build, and Playwright 14/14.

## Owners

- Chief: scope, sequencing, evidence boundaries, knowledge disposition, release.
- Backend implementer: bounded analysis and citation changes only.
- Frontend implementer: UI-owned paths only when a frontend delta is required.
- Independent Reviewer: final `PASS | REQUEST_CHANGES | BLOCKED` verdict; no
  implementation edits.

## Immediate Next Action

Commit and push the accepted candidate, apply schema v10 migration, deploy and
bind fresh runtime/provider attestations, then run one controlled Edmonton pilot.
Only a READY pilot that passes golden, cleanup, cost, latency, and receipt-audit
checks can authorize the remaining campaign.
