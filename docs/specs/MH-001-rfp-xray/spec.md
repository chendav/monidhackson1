# RFP X-Ray Contest MVP

Task ID: MH-001

## Outcome

Deliver a public, English Web/API MVP that converts a user-supplied tender pack
into an auditable brief, compliance matrix, evaluation model, risks, amendment
conflicts, grounded Q&A, and a transparent cost ledger without performing search.

## Background

The formal competitive target is the document-analysis portion of bidworx
Starter (£190/month), not the vendor's broader collaboration or writing tiers.
Edmonton 100022184-A is the development fixture; CER 84084-26-0009/A and its
three amendments are the multi-document live-demo fixture.

## In Scope

- CanadaBuys URL and signed PDF upload ingestion.
- Monid parsing, local page indexing, source deletion, structured extraction.
- Amendment ordering, supersession, contradiction detection, verified citations.
- English Web UI, JSON API/OpenAPI, grounded Q&A, audit/cost display.
- Quotas, budget guardrails, retention cleanup, tests and deployment preparation.

## Out of Scope

- Tender search or traversal of links contained inside tenders.
- Proposal writing, bid/no-bid scoring, win probability, accounts, billing,
  collaboration, CV libraries, CRM, SSO, or persistent PDF viewing.

## Constraints

- Next.js/TypeScript on Vercel, Neon/Postgres, Vercel Workflow, and a private
  Railway S3-compatible Bucket. Railway runs no application compute service;
  Vercel Private Blob remains an adapter fallback.
- Maximum five documents, 25MB each, 300 aggregate pages.
- URL ingestion is restricted to HTTPS on `canadabuys.canada.ca`.
- Source and raw intermediate deletion confirmations are required before READY.
- Only structured/redacted output and short evidence quotes persist for 24 hours.
- No secrets or copyrighted source PDFs in Git.
- UI, API docs, and launch materials use English.

## Acceptance Criteria

- AC-1: URL/upload package limits and validation are enforced.
- AC-2: Closed-world processing records zero search/link/script/tool events.
- AC-3: READY is impossible until controlled source/intermediate cleanup succeeds.
- AC-4: Critical claims have verified SHA-bound physical-page citations.
- AC-5: Edmonton golden extraction and document-structure tests pass.
- AC-6: CER replacement, order-independence, and conflict tests pass.
- AC-7: Versioned API/OpenAPI and lifecycle operations match shared contracts.
- AC-8: Responsive English working surface exposes all required result states.
- AC-9: Authentication boundaries, quotas, budget, logging, and retention pass.
- AC-10: Lint, typecheck, tests, build and Playwright pass.
- AC-11: Independent Reviewer reports PASS with P0=0 and P1=0.

## Risks and Unknowns

- Current Monid contract, provider retention, pricing, and available credentials.
- Deployment credentials and runtime plan limits.
- Model quality/cost must be measured rather than inferred.
