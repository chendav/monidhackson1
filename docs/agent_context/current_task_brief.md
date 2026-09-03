# Current Task Brief

- Task ID: MH-001
- Title: RFP X-Ray contest MVP
- Status: Revision 4 release candidate awaiting independent re-review
- Chief owner: chief
- Updated: 2026-09-03

## Outcome

Build an English public Web and JSON API that analyzes user-supplied tender PDFs
without searching. The MVP replaces the document-analysis portion of bidworx
Starter for one real RFP: summary, requirements, evaluation, risks, amendment
reconciliation, grounded Q&A, citations, cleanup proof, and per-run cost.

## In Scope

- Next.js/TypeScript working surface and public API.
- Vercel Workflow, Neon/Postgres contracts, and Vercel Private Blob ingress.
- Monid context.dev parsing adapter and OpenAI Structured Outputs adapter.
- Edmonton golden fixture and CER base-plus-amendments regression fixture.
- Source cleanup gate, cost ledger, rate limits, and audit metadata.
- Automated checks, independent review, deployment/runbook documentation.

## Out of Scope

- Tender search, response writing, team collaboration, CV library, CRM, SSO.
- Bid/no-bid, win probability, or bidder-fit claims without bidder data.
- Billing, account management, long-term document retention, PDF server viewer.

## Acceptance Criteria

- AC-1: A user can create a package from an allowlisted CanadaBuys URL or signed
  PDF upload, with five-document/25MB-per-document/300-page limits enforced.
- AC-2: Runtime processing is closed-world: no search, embedded-link traversal,
  PDF JavaScript execution, or document-originated tool calls.
- AC-3: A run cannot become ready until every source and raw intermediate under
  app control has a recorded deletion confirmation.
- AC-4: Every critical visible claim has a verified SHA-bound physical-page
  citation, while unsupported facts are omitted or marked unknown/conflicted.
- AC-5: Edmonton golden facts, requirements, evaluation, security, pricing
  blanks, form pages, and Annex D/E inconsistency pass deterministic tests.
- AC-6: CER documents reconcile independent of upload order and preserve
  superseded values while surfacing the 2050/2055 amendment conflict.
- AC-7: The versioned API, OpenAPI document, stable status model, idempotency,
  Q&A, deletion, sample, and health routes match the task specification.
- AC-8: The responsive English UI exposes ingestion, progress, six analysis
  surfaces, citations, cleanup status, source scope, and actual/estimated cost.
- AC-9: Guest/API authentication boundaries, quotas, budget reservation,
  sensitive-log redaction, and source retention policies are enforced.
- AC-10: Lint, typecheck, unit, integration, golden, build, and browser E2E pass.
- AC-11: Independent Reviewer returns PASS with P0=0 and P1=0.

## Current Phase

The latest independent exact-commit review of `97c1417` found five P1 issues and
no P0. Revision 4 closes admission concurrency, evidence-field binding,
source-authorized amendment scope, cross-page stale risks, quota retention,
uncertain Workflow acknowledgement, and orphan Blob-fence paths. It passes 122
local tests, the five-official-PDF audit, production build, and 14 browser tests.
Credentialed Monid/Blob/Neon/Workflow/Turnstile deployment gates remain; this is
not yet a release approval.

## Immediate Next Action

Commit the Revision 4 candidate, rerun the exact-commit QA gate, and return it to
the same independent Reviewer. Require `APPROVE`, P0=0, and P1=0 before any
release claim; keep production fail-closed until platform credentials and live
provider evidence are configured.
