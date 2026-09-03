# Current System State

Updated: 2026-09-03

## Confirmed

- The repository is on `main`, connected to origin, and reviewed application
  commit `936041e8ca1ed626978ee8750ba640ef4975c4d9` is pushed. The remaining
  working-tree changes refresh release documentation/evidence only.
- The application is a single Next.js/TypeScript repository using Vercel for
  Web/API/Workflow compute, Neon for durable state, and the dedicated Railway
  `rfp-xray-private` S3-compatible Bucket for temporary private objects.
  Railway also runs one no-domain maintenance Cron with zero instances between
  invocations; it runs no RFP analysis worker. The unrelated
  `ontology-ai-ready` project was not changed.
- The Vercel project is configured for Node 22 and Fluid Compute. The current
  code requires a deployment-bound 300-second Workflow runtime attestation
  before source or paid work.
- Runtime-attestation code was independently reviewed: `APPROVE`, P0=0,
  P1=0, P2=0. Captured deployment `dpl_EW9Bt6QLnhbMSwhEL5yY3AaJ64GE` has an
  exact receipt binding its ID, URL, project, team, Git SHA, runtime, duration,
  region, memory, SDK version, internal deadlines, TTL, and payload hash.
- Provider-contract attestation code was independently reviewed: `APPROVE`,
  P0=0, P1=0, P2=0. It performs a credentialed non-paid Monid inspect and a
  non-paid OpenAI control-plane check and binds the result to deployment
  identity. No receipt exists because the Monid key/configuration is absent.
- The release tooling pins Vercel CLI 59.11.2. Thirty-three focused
  runtime/provider attestation tests pass after the dependency overrides.
- The security re-review returned `APPROVE`, P0=0 and P1=0. Its two P2
  recommendations were subsequently implemented and tested.
- Current local regression evidence is: `pnpm check` 39 files passed/3 skipped,
  391 tests passed/7 skipped; build PASS with 10 Workflow steps, 4 workflows,
  and 13 pages; local E2E 14 passed/2 explicit live skips; official fixture
  audit 3/3; production dependency audit reports no known vulnerabilities. The
  full dependency audit has no high/critical findings and retains 1 low/3
  moderate development-chain findings after scoped overrides.
- Neon is at schema v8: 9 public tables, 8 migration-ledger rows, marker
  `rfp-xray-schema-v8`. The migration rerun is idempotent. The live concurrency
  suite passed 2/2, including application contention and an actual CAS-loss
  path.
- Railway storage has a target-bound safety attestation expiring
  2026-09-10 04:11:53 MDT. The current live S3 suite passed 1/1. A real Chromium
  PUT/read/fence/replay/delete probe using
  `https://rfp-xray.vercel.app` as the browser Origin passed 1/1. These are
  storage component facts, not end-to-end Monid facts.
- `CRON_SECRET` is rotated consistently across Vercel production/preview,
  GitHub Actions, and Railway. GitHub maintenance is enabled and manual
  dispatch succeeds. Railway completed three consecutive automatic cycles;
  durable heartbeats remained fresh and independent review returned
  `APPROVE`, P0/P1/P2=0.
- The bidworx pricing screenshot at
  `docs/specs/MH-001-rfp-xray/release-evidence/bidworx-pricing-2026-09-03.png`
  is 714876 bytes with SHA-256
  `5a4d44ba608131cabb7770a28321d85d5552ba52fb4f86fb0b3520340b4f9b34`.
  It was captured at `2026-09-03T11:46:40.5885646Z` from the official pricing
  page and shows Starter at £190/month with typical usage of one tender.
- Chrome and in-app interactive browser automation are unavailable. Local and
  remote automated probes do not substitute for the required human production
  citation review.
- The S3/runtime/provider receipt refresh heartbeat is scheduled for
  2026-09-09 and 2026-09-10 at 12:00 MDT.

## Inferred

- Vercel Fluid Compute can host this release candidate without a Railway analysis worker,
  provided the deployment-bound runtime receipt and real provider benchmarks
  pass.
- The single-application architecture remains the lowest-coordination option;
  Railway compute should be reconsidered only if measured Monid/CER execution
  cannot preserve the 285-second commit deadline and cleanup headroom.

## Unknown or not yet proven

- Exact account-visible Monid parse/price/retention behavior, signed-URL
  compatibility, actual parse cost, and Edmonton/CER quality remain unverified.
- Turnstile production configuration is absent.
- The evidence-only deployment still needs its own Vercel runtime receipt; no
  provider-contract receipt exists.
- Live-provider Workflow execution, hard-kill recovery, end-to-end source
  cleanup timing, and production citation links remain unverified.
- No paid Monid work, real Edmonton/CER campaign, 90-second video, contest
  submission, or social publication has occurred.

## Active constraints

- Production must fail closed when storage, database, runtime, provider,
  maintenance, Monid, OpenAI, or Turnstile requirements are missing.
- Never persist or disclose API keys, database URLs, signed object URLs, raw
  tender PDFs, parsed Markdown, or provider payloads in release evidence.
- The 105/150/285-second internal deadlines and 300-second route capability are
  enforced design facts, not latency evidence.
- A passing component probe is not an end-to-end release. The current verdict
  is `NOT_READY` until the committed deployment and all live-provider gates pass.
