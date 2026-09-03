# Current System State

Updated: 2026-09-03

## Confirmed

- The repository is on `main`, connected to origin, and release commit
  `76e0f4e01f93d67eab4da9b98807959b81578396` is pushed and deployed. Its
  application-code parent is
  `fbb48d09bda4f8d671f6b1679c66d3e0400f45db`. CI run `33793276409` passed.
- Local reviewed implementation commit `4089397de8f2cfc3dc4846911bd9767adea178f4` is
  intentionally not pushed yet. It includes
  the watchdog-reclaim fence, video evidence gate, provider-free Workflow
  redelivery canary, read-only existing-run verifier, Vercel list-page
  compatibility fix, and reproducible read-only log-receipt generator. It must
  ship in the single final Turnstile-triggered deployment.
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
  P1=0, P2=0. Production deployment `dpl_5dMrPWKGMCKxy5hcQUfq57uLmZce` has an
  exact receipt binding its ID, URL, project, team, Git SHA, runtime, duration,
  region, memory, SDK version, internal deadlines, TTL, and payload hash. The
  receipt payload SHA-256 is
  `5d50e812e28ee43fdc81bd99c8a2a291a737ff3c607ccb2d148cbba97aa14dbf` and
  expires at `2026-09-04T19:00:58.845Z` unless refreshed first.
- Provider-contract attestation code was independently reviewed: `APPROVE`,
  P0=0, P1=0, P2=0. The intended Monid workspace is authenticated, the exact
  `context.dev /parse` configuration is stored in Vercel, and credentialed
  discovery/inspect plus two paid Edmonton parses succeeded. Deployment
  `dpl_5dMrPWKGMCKxy5hcQUfq57uLmZce` also has a Monid/OpenAI receipt with
  payload SHA-256
  `0c8ede2c44fc3ff8038eea7640573bdef5cbbb0523ae7583e66b5e8f1743fe07`,
  expiring at `2026-09-04T19:01:09.386Z`.
- The release tooling pins Vercel CLI 59.11.2. Thirty-three focused
  runtime/provider attestation tests pass after the dependency overrides.
- The security re-review returned `APPROVE`, P0=0 and P1=0. Its two P2
  recommendations were subsequently implemented and tested.
- Current local regression evidence is: `pnpm check` 47 files passed/4 skipped,
  465 tests passed/10 skipped; build PASS with 9 Workflow steps, 5 workflows,
  and 13 pages; local E2E 14 passed/2 explicit live skips; official fixture
  audit 3/3; production dependency audit reports no known vulnerabilities. The
  full dependency audit has no high/critical findings and retains 1 low/3
  moderate development-chain findings after scoped overrides.
- Neon is at schema v9: 9 public tables, 9 migration-ledger rows, marker
  `rfp-xray-schema-v9`. The migration rerun is idempotent. The live concurrency
  suite passed 4/4, including application contention, an actual CAS-loss path,
  and real 16-way cleanup-retry and analysis-dispatch claim races.
- The current candidate permanently fences analysis Workflow dispatch before
  `start()`: claim, start, and settlement ACK-loss paths never blind-redispatch,
  and maintenance owns the queued failure/cleanup fallback. Final independent
  review approved the current working tree with P0=0, P1=0, and P2=0.
- The local candidate also refuses an expired processing-lease reclaim after
  any source-cleanup watchdog has been armed, preventing duplicate watchdog
  scheduling across a hard kill before the paid-call marker. Independent delta
  review approved this fence with P0=0, P1=0, and two non-blocking test-hardening
  suggestions.
- One isolated, provider-free Preview canary was hard-killed once and recovered
  through Vercel Workflow redelivery. The first verifier correctly failed
  because Vercel omitted optional attempt values from event payloads. A revised,
  independently approved verifier then re-read the same completed run with
  `workflow_start_count=0` and established the ordered `[1,2]` attempt sequence
  from two same-step starts, the completed materialized step at attempt 2, and
  the exact attempt-2 output. The run had seven lifecycle events, one completion,
  zero retry/failure events, and no third attempt. A separate bounded Vercel log
  receipt found exactly one literal `SIGKILL` record and one deployed kill
  callsite. The log contains no raw run ID, so this is explicitly bounded to
  the exact deployment and two-minute window, not claimed as exact-run log
  binding. The generator and combined evidence received independent
  `APPROVE`, P0=0/P1=0. This proves isolated platform redelivery, not full
  application cleanup recovery. See
  `docs/specs/MH-001-rfp-xray/release-evidence/workflow-recovery-canary-2026-09-03.md`.
- The conservative five-document full reserve is USD 1.412123, including 24
  generated function invocations; this remains estimated rather than a live
  Vercel usage receipt.
- Railway storage has a target-bound safety attestation expiring
  2026-09-10 04:11:53 MDT. The current live S3 suite passed 1/1. A real Chromium
  PUT/read/fence/replay/delete probe using
  `https://rfp-xray.vercel.app` as the browser Origin passed 1/1. These are
  storage component facts, not end-to-end Monid facts.
- `CRON_SECRET` is rotated consistently across Vercel production/preview,
  GitHub Actions, and Railway. GitHub maintenance is enabled and manual
  dispatch succeeds. Railway completed seven consecutive automatic cycles from
  13:19Z through 13:49Z, exceeding a 30-minute observation window; durable
  heartbeats remained fresh and independent review returned `APPROVE`,
  P0/P1/P2=0. GitHub `schedule` delivery remains unobserved redundancy.
- The bidworx pricing screenshot at
  `docs/specs/MH-001-rfp-xray/release-evidence/bidworx-pricing-2026-09-03.png`
  is 714876 bytes with SHA-256
  `5a4d44ba608131cabb7770a28321d85d5552ba52fb4f86fb0b3520340b4f9b34`.
  It was captured at `2026-09-03T11:46:40.5885646Z` from the official pricing
  page and shows Starter at £190/month with typical usage of one tender.
- The Monid contract spike passed signed-URL compatibility and application-
  controlled source cleanup. Two successful parses cost USD 0.0009 each. The
  signed-URL path captured identical 144,275-byte Markdown and confirmed source
  absence in 8.140 seconds. Monid emitted no trustworthy physical-page markers,
  so PDF.js remains citation truth.
- Context.dev ZDR is not enabled for this workspace. A successful response
  reported an upstream artifact expiry of seven days and no provider early-
  delete API is known. The source form and audit view now disclose this before
  submission and must not promise deletion outside application control.
- Interactive production citation review has not yet been performed. Local and
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

- Credentialed Monid contract/price/retention, signed-URL compatibility, and a
  single Edmonton normalization run are proven; ten-run Edmonton consistency,
  CER package quality, OCR/scanned quality, and full production Workflow
  behavior remain unverified.
- A Cloudflare Managed Turnstile widget now allowlists only
  `rfp-xray.vercel.app`. Its site key, secret, and exact expected hostname are
  configured in Vercel Production, with the secret stored as a sensitive value.
  The current deployment predates those variables and therefore still returns
  `503 not_ready`; the keys are not considered live until the final redeployment
  reaches READY and the zero-cost browser challenge passes.
- Production schema v9 is applied, probed, and served by the matching deployed
  application candidate.
- The current deployment has both its own Vercel runtime receipt and a
  Monid/OpenAI provider-contract receipt. Both must be renewed after any
  credential-triggered redeployment and before expiry.
- Isolated provider-free Workflow hard-kill redelivery is proven. Live-provider
  Workflow execution, full application recovery, end-to-end source cleanup
  timing, and production citation links remain unverified.
- Two bounded paid Monid parse calls occurred for the contract spike. The real
  ten-run Edmonton/CER campaign, 90-second video, contest submission, and social
  publication have not occurred.
- A 90-second English video scaffold is prepared under
  `videos/rfp-xray-launch/`; it intentionally remains unrendered and carries
  explicit live-evidence placeholders until the production campaign supplies
  the real captures, cost, and duration. Scaffold commit
  `fc054660aab99dbb46128a7d519bf1885f43ad5a` is local-only; its deterministic
  evidence gate is independently approved P0=0/P1=0 and currently blocks on 23
  real open markers.

## Active constraints

- Production must fail closed when storage, database, runtime, provider,
  maintenance, Monid, OpenAI, or Turnstile requirements are missing.
- Never persist or disclose API keys, database URLs, signed object URLs, raw
  tender PDFs, parsed Markdown, or provider payloads in release evidence.
- The 105/150/285-second internal deadlines and 300-second route capability are
  enforced design facts, not latency evidence.
- A passing component probe is not an end-to-end release. The current verdict
  is `NOT_READY` until all live-provider and contest-evidence gates pass.
- Remaining gates include the Turnstile-triggered exact redeployment and
  refreshed attestations, paid Edmonton/CER campaigns,
  production citation clicks, final video, contest submission, and five social
  publications.
