# Current Task Brief

- Task ID: MH-001
- Title: RFP X-Ray contest MVP
- Status: Deployed fail-closed release candidate; live-provider and contest gates remain open
- Chief owner: chief
- Updated: 2026-09-03
- Release commit: `76e0f4e01f93d67eab4da9b98807959b81578396`;
  application-code parent
  `fbb48d09bda4f8d671f6b1679c66d3e0400f45db`; pushed to `origin/main`,
  deployed, and independently re-reviewed.
- Local reviewed implementation commit:
  `4089397de8f2cfc3dc4846911bd9767adea178f4`; its watchdog-reclaim,
  provider-free redelivery, and reproducible read-only log-receipt changes were
  independently approved with P0=0 and P1=0. It is intentionally not pushed
  until the Turnstile deployment gate can be closed in the same release.

## Outcome

Build an English public Web and JSON API that analyzes a user-supplied tender
pack without searching. The product targets the document-analysis portion of
bidworx Starter: summary, requirements, evaluation, risk review, amendment
reconciliation, grounded Q&A, page citations, cleanup proof, and per-run cost.

## Scope boundary

In scope are the Next.js/TypeScript Web and API, Vercel Workflow, Neon state,
Railway private object storage and short-lived maintenance Cron, Monid parsing,
OpenAI structured extraction, Edmonton and CER evidence, cleanup/cost controls,
and independent review.
Tender search, bid writing, team collaboration, CRM, SSO, billing, bidder-fit
predictions, and long-term tender storage remain out of scope.

## Current release evidence

- `pnpm check`: PASS, 47 test files passed and 4 skipped; 465 tests passed and
  10 explicitly skipped. The live-only skips include the deliberate paid
  Monid/Railway contract probe, which passed 1/1 when explicitly enabled, and
  the new Neon cleanup-retry and analysis-dispatch CAS race probes, which now
  pass 4/4 against production schema v9.
- Production build: PASS, emitting 9 Workflow steps, 5 workflows, and 13
  application pages.
- Local Playwright: 14 passed and 2 explicit live-environment skips.
- Official fixture audit: 3/3 passed.
- Production dependency audit: no known vulnerabilities. The full audit has no
  high/critical findings; four lower-severity development-chain findings remain
  (1 low, 3 moderate) after scoped overrides.
- Neon: 9 public tables, 9 migration-ledger rows, schema marker
  `rfp-xray-schema-v9`; live concurrency/CAS probe passed 4/4, including real
  16-way cleanup-retry and analysis-dispatch claim races.
- Railway storage: bound attestation valid until 2026-09-10 04:11:53 MDT; live
  S3 probe passed 1/1 and real Chromium storage probe with the production
  origin `https://rfp-xray.vercel.app` passed 1/1.
- Vercel project configuration is Node 22 with Fluid Compute enabled. The
  deployment-bound 300-second Workflow runtime-attestation implementation was
  independently approved with P0/P1/P2=0. Production deployment
  `dpl_5dMrPWKGMCKxy5hcQUfq57uLmZce` is READY and has its own current receipt,
  bound to release commit `76e0f4e01f93d67eab4da9b98807959b81578396`.
- Provider-contract attestation was independently approved with P0/P1/P2=0.
  The intended Monid workspace is authenticated, exact `context.dev /parse`
  configuration is stored in Vercel, and two credentialed Edmonton parses cost
  USD 0.0009 each. One used a five-minute Railway signed URL and confirmed
  application-controlled source deletion in 8.140 seconds. The current exact
  deployment has a successful Monid/OpenAI provider-contract receipt.
- The pinned Vercel CLI remains 59.11.2; 33 focused runtime/provider attestation
  tests pass after dependency overrides.
- The final security re-review returned `APPROVE`, P0=0 and P1=0; both P2
  recommendations were implemented and tested.
- The permanent analysis-Workflow dispatch claim now covers claim, start, and
  settlement ACK loss without blind redispatch. The final independent review
  approved the current working tree with P0=0, P1=0, and P2=0.
- The strict five-document reserve is USD 1.412123 and includes 24 generated
  function invocations. It is a conservative estimate, not a provider receipt.
- `CRON_SECRET` was rotated consistently in Vercel production/preview, GitHub
  Actions, and Railway. Railway Cron completed seven consecutive scheduled
  cycles across more than 30 minutes with zero between-run instances;
  independent review returned `APPROVE`, P0/P1/P2=0. GitHub manual dispatch
  works, but its schedule event remains unobserved and is treated as
  redundancy.
- A sanitized bidworx price capture records Starter at £190/month with typical
  usage of one tender. It is price evidence only.
- One provider-free Preview Workflow canary was started exactly once, received
  a real process `SIGKILL`, and completed after same-step redelivery. The
  revised verifier re-read that same run with `workflow_start_count=0`; Vercel
  omitted event attempt values, so `[1,2]` is explicitly marked as derived from
  two ordered starts plus the completed materialized step/output at attempt 2.
  A separately generated Vercel log receipt is deployment-and-window-bounded,
  not exact-run-bound, because the raw log row contains no Workflow run ID.
  Its tracked generator and combined evidence received independent `APPROVE`,
  P0=0/P1=0.
  This is platform-redelivery evidence only, not full application recovery.

## Evidence boundary

The public deployment at https://rfp-xray.vercel.app serves the reviewed
fail-closed application and passed remote smoke 4/4. It must not be described
as live-provider ready: the Cloudflare widget and three Vercel Production
variables are configured, but the current deployment predates them and health
therefore remains 503 until redeployment. Schema v9, the matching release
deployment, and both exact-deployment attestations are present.

The contract spike is not the final campaign. It also proved that Context.dev
ZDR is unavailable for this workspace and reported a seven-day upstream
artifact expiry; that limitation is now disclosed before submission and in the
audit view. No complete Edmonton/CER production campaign, deployment-bound
provider receipt, production citation click-through, final video, contest
submission, or five-platform social publication has occurred. The deployed
Turnstile challenge and required interactive production review have not run.
The release verdict therefore remains `NOT_READY`.

## Immediate next action

Redeploy once with the configured Turnstile values, then issue fresh runtime and
provider-contract attestations for that exact deployment before any public
mutation. After every preflight gate passes, run the budget-capped
Edmonton/CER campaigns and click at least 12 production citations. The final
video, contest submission, and five social publications remain open. Continue
monitoring the independently approved Railway maintenance Cron without adding
another compute runtime.

The S3, runtime, and provider receipt refresh heartbeat is scheduled for
2026-09-09 and 2026-09-10 at 12:00 MDT.
