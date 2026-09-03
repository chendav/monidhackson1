# Current Task Brief

- Task ID: MH-001
- Title: RFP X-Ray contest MVP
- Status: Pre-deploy release candidate; live-provider and contest gates remain open
- Chief owner: chief
- Updated: 2026-09-03
- Reviewed implementation commit: `dfc8be9`; documentation/evidence changes are
  being finalized for the same release push.

## Outcome

Build an English public Web and JSON API that analyzes a user-supplied tender
pack without searching. The product targets the document-analysis portion of
bidworx Starter: summary, requirements, evaluation, risk review, amendment
reconciliation, grounded Q&A, page citations, cleanup proof, and per-run cost.

## Scope boundary

In scope are the Next.js/TypeScript Web and API, Vercel Workflow, Neon state,
Railway private object storage, Monid parsing, OpenAI structured extraction,
Edmonton and CER evidence, cleanup/cost controls, and independent review.
Tender search, bid writing, team collaboration, CRM, SSO, billing, bidder-fit
predictions, and long-term tender storage remain out of scope.

## Current pre-deploy evidence

- `pnpm check`: PASS, 39 test files passed and 3 skipped; 391 tests passed and
  7 explicitly skipped.
- Production build: PASS, emitting 10 Workflow steps, 4 workflows, and 13
  application pages.
- Local Playwright: 14 passed and 2 explicit live-environment skips.
- Official fixture audit: 3/3 passed.
- Production dependency audit: no known vulnerabilities. The full audit has no
  high/critical findings; four lower-severity development-chain findings remain
  (1 low, 3 moderate) after scoped overrides.
- Neon: 9 public tables, 8 migration-ledger rows, schema marker
  `rfp-xray-schema-v8`; live concurrency/CAS probe passed 2/2, including a real
  compare-and-swap loss.
- Railway storage: bound attestation valid until 2026-09-10 04:11:53 MDT; live
  S3 probe passed 1/1 and real Chromium storage probe with the production
  origin `https://rfp-xray.vercel.app` passed 1/1.
- Vercel project configuration is Node 22 with Fluid Compute enabled. The
  deployment-bound 300-second Workflow runtime-attestation implementation was
  independently approved with P0/P1/P2=0. No current runtime receipt can exist
  until the clean committed deployment is available.
- Provider-contract attestation was independently approved with P0/P1/P2=0.
  No provider receipt or provider call exists because the Monid key and exact
  provider configuration are absent.
- The pinned Vercel CLI remains 59.11.2; 33 focused runtime/provider attestation
  tests pass after dependency overrides.
- The final security re-review returned `APPROVE`, P0=0 and P1=0; both P2
  recommendations were implemented and tested.
- `CRON_SECRET` was rotated consistently in Vercel production/preview and
  GitHub Actions. The GitHub maintenance variable deliberately remains `false`
  until the new deployment is live.
- A sanitized bidworx price capture records Starter at £190/month with typical
  usage of one tender. It is price evidence only.

## Evidence boundary

The public deployment at https://rfp-xray.vercel.app still serves the older
sample build because reviewed implementation commit `dfc8be9` has not yet been
pushed. Its sample endpoints must not be
used as evidence for the new storage, runtime, provider-attestation, or
maintenance path.

No paid Monid call, real Edmonton/CER campaign, provider-retention proof,
end-to-end production cleanup receipt, production citation click-through,
final video, contest submission, or social publication has occurred. Turnstile
is absent, and Chrome/in-app interactive browser control is unavailable. The
release verdict therefore remains `NOT_READY`.

## Immediate next action

Commit the reviewed documentation/evidence and push the two local release
commits, allow the new Vercel production deployment, then create the
deployment-bound runtime receipt and recheck fail-closed health. Enable GitHub
maintenance only after that deployment and one successful bounded heartbeat.
Obtain the Monid and Turnstile credentials before any provider call or public
mutation. Run the budget-capped Edmonton/CER campaign and independent deployed
citation review only after every preflight gate passes.

The S3, runtime, and provider receipt refresh heartbeat is scheduled for
2026-09-09 and 2026-09-10 at 12:00 MDT.
