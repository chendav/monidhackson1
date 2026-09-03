# Current Task Brief

- Task ID: MH-001
- Title: RFP X-Ray contest MVP
- Status: Local release candidate approved; credentialed production gates open
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

Commit `cc2831c` is the independently approved local release candidate.
`pnpm check` passes 234 tests with 3 credential/fixture-gated skips; the official
PDF audit passes 3/3, the production build emits 9 Workflow steps/3 workflows,
and Playwright passes 14/14. Two bounded adversarial reviewers and the final
Independent Reviewer report P0=0 and P1=0. Credentialed Monid, Blob, Neon,
Workflow, Turnstile, cost, latency, deployment, video, and publication gates
remain open, so this is not yet a production or contest-completion claim.

## Immediate Next Action

Run the Monid contract spike and credentialed Vercel/Neon evidence suite, then
execute the Edmonton ten-run benchmark and complete CER production demo. Keep
production fail-closed until all provider configuration and cleanup receipts are
verified. Continue with Vercel Workflow; add Railway only if measured runtime or
long-lived-worker requirements invalidate the current architecture.
