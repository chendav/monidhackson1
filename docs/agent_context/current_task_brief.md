# Current Task Brief

- Task ID: MH-001
- Title: RFP X-Ray contest MVP
- Status: active; production is live, but the Edmonton analysis candidate is under
  `REQUEST_CHANGES`
- Chief owner: chief
- Updated: 2026-09-03
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

- `main` and `origin/main` are at `d0b937e8e75ae5b2ae52985f1e1a0cfc7f13a0c5`;
  the working tree contains an uncommitted Edmonton core-field recovery delta.
- Production at `https://rfp-xray.vercel.app` reports live health with database,
  storage, Workflow, Monid, and OpenAI gates ready.
- The last controlled Edmonton run reached `partial`, not READY. It cost
  USD 1.020701, completed controlled cleanup, and recovered requirements,
  security facts, M1-M4, and the Annex D/E conflict, but evaluation and several
  executive fields were absent.
- Focused official/unit checks pass 46/46, but independent review currently
  returns `REQUEST_CHANGES` (source reviewer wording: `REVISE`) with two P1
  submission-channel ambiguity defects and one P2 classifier-drift concern.
- The refreshed Chief Agent rules are active. This legacy review sequence is
  treated as having reached the three-round ceiling; the next implementation
  must be a bounded classifier redesign, not another unstructured patch loop.

## Owners

- Chief: scope, sequencing, evidence boundaries, knowledge disposition, release.
- Backend implementer: bounded analysis and citation changes only.
- Frontend implementer: UI-owned paths only when a frontend delta is required.
- Independent Reviewer: final `PASS | REQUEST_CHANGES | BLOCKED` verdict; no
  implementation edits.

## Immediate Next Action

Replace the duplicated submission-channel heuristics with one shared classifier
that distinguishes publishable evidence from possible ambiguity. Re-run focused
and full regression gates, obtain an independent `PASS`, then deploy once and
repeat the controlled Edmonton run before starting the CER campaign.
