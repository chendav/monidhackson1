# Runtime Decision: Vercel Workflow + Railway Private Storage and Cron

Decided: 2026-09-03. Current evidence refreshed: 2026-09-03.

## Decision

Keep Web, API, Workflow execution, and durable application state on Vercel and
Neon. Use the dedicated Railway `rfp-xray-private` S3-compatible Bucket for
short-lived private source objects. Add one minimal Railway Cron service that
calls the authenticated Vercel maintenance endpoint every five minutes and
then exits. It has no public domain, no always-on instance, and no Monid,
OpenAI, database, object-storage, session, or Turnstile credentials. It holds
only the maintenance URL and dedicated maintenance secret, and it does not
execute RFP analysis. The unrelated `ontology-ai-ready` project was not
modified.

This replaces the unavailable Vercel Private Blob dependency and supplies a
bounded maintenance trigger without creating a second analysis runtime.
Railway analysis compute remains a contingency only if real provider timings
cannot preserve the Vercel result-commit and cleanup headroom.

## Current Vercel runtime contract

- Project setting: Node 22.x.
- Fluid Compute: enabled.
- Required Workflow flow and step route capability: at least 300 seconds.
- Internal source-download/Monid deadline: 105 seconds.
- Pre-model deadline: 150 seconds from start.
- Result-commit deadline: 285 seconds from start.
- Monid document concurrency: 4.

The earlier 60-second Hobby analysis was superseded after Fluid Compute and the
actual generated Workflow flow/step route configuration were inspected. The
current design does not trust account settings or source declarations alone.
Before any source or paid work it requires a short-lived release attestation
bound to the exact deployment ID and URL, Vercel project/team, Git SHA,
Node runtime, flow/step duration, memory, regions, Workflow SDK, internal
deadlines, TTL, and canonical payload hash.

The runtime-attestation implementation received independent `APPROVE` with
P0=0, P1=0, and P2=0. Production deployment
`dpl_5dMrPWKGMCKxy5hcQUfq57uLmZce` was built from Git SHA
`76e0f4e01f93d67eab4da9b98807959b81578396` and has a current deployment-
bound runtime receipt at evidence capture. Any
subsequent deployment must receive its own receipt; receipts must never be
copied between deployment IDs.

The 300/105/150/285 values are enforced capability/policy bounds, not measured
latency. They do not prove that ten Edmonton analyses or the CER package fit.

## Railway storage contract

The target-bound Railway storage attestation validates the endpoint, region,
bucket, virtual-host style, exact CORS origins, absent versioning/Object Lock,
empty historical versions, replay fence, and physical deletion behavior. It
expires on 2026-09-10 04:11:53 MDT.

The current checked-in live S3 suite passed 1/1. A real Chromium
PUT/read/fence/replay/delete flow with `https://rfp-xray.vercel.app` as the
Origin also passed 1/1. These facts close only the private-storage component
contract while its receipt is current; they do not prove Monid signed-URL
fetching, end-to-end cleanup timing, or deployed guest mutations.

## Neon and maintenance contract

The active Neon database reports 9 public tables, 9 migration-ledger rows,
schema version 9, and marker `rfp-xray-schema-v9`. The live concurrency suite
passed 4/4, including application contention, an actual compare-and-swap loss,
and real 16-way cleanup-retry and analysis-dispatch claim races.

Recurring maintenance requires both a shared secret and a recent successful
bounded heartbeat. `CRON_SECRET` is rotated consistently in Vercel
production/preview, GitHub Actions, and the dedicated Railway Cron service.
GitHub Actions is enabled but did not produce a real `schedule` event during
the observation window, despite successful manual dispatches. It therefore
remains redundancy rather than the sole freshness dependency.

Railway service `maintenance-cron` uses the pinned
`curlimages/curl@sha256:58adaa4e8dca9c988bae2aba4ab3434a0bb2da16bbe3f92dec39ec7785166777`
image, schedule `4-59/5 * * * *`, restart policy `NEVER`, no public domain, and
zero instances between invocations. Seven consecutive real invocations across
more than 30 minutes produced bounded Neon heartbeats with no recorded
failures. See
`release-evidence/railway-maintenance-cron.md`.

## Provider contract

Provider-contract attestation code received independent `APPROVE` with P0=0,
P1=0, and P2=0. It uses credentialed non-paid Monid inspect plus a non-paid
OpenAI control-plane check and binds the result to the same deployment identity.
The intended Monid workspace is now authenticated, the exact configuration is
stored in Vercel, and two paid Edmonton contract-spike parses passed. The
five-minute signed-URL path captured its artifact and confirmed source cleanup
in 8.140 seconds, well within the Vercel envelope. The current exact deployment
has a successful Monid/OpenAI provider receipt. Production Turnstile is
configured but not present in that older immutable deployment; the resulting
redeployment must receive fresh runtime and provider receipts.

## Why Railway does not run the application

- Vercel owns HTTP routing, Workflow execution, observability, and recovery.
- Neon owns durable state, quotas, leases, costs, heartbeats, and attestations.
- Railway supplies private S3-compatible objects, signed browser ingress, and
  one short-lived maintenance trigger.
- Monid/context.dev remains the remote parsing candidate, so no always-on OCR
  or parser daemon is currently required.

Moving analysis compute to Railway would add a second queue, worker lifecycle,
runtime-attestation surface, and cost ledger before measured evidence justifies
it. The Cron service is deliberately narrower: it owns only the maintenance URL
and shared secret, starts on schedule, and exits after one bounded request.

## Why not Railway-only for the contest release

A Railway-only architecture is viable, but it is a migration rather than a
deployment toggle. The current scheduler intentionally fails closed outside
Vercel and relies on Vercel Workflow for durable sleeps, retries, callbacks,
and recovery. Moving now would require a database queue, a continuously
available lease-owning worker, replacement workflow observability, new failure
tests and receipts, and—if “only” is literal—a Neon-to-Railway Postgres
migration. That reduces vendor count while increasing code and validation risk
inside the seven-day contest window.

Reconsider consolidation after the Edmonton/CER benchmark. A Railway-only
design becomes justified if the 285-300 second Vercel envelope fails, local OCR
or sustained CPU is required, or measured Vercel cost/reliability is worse. In
that case move Web, worker, Postgres, and Bucket together; do not create a
half-migrated second analysis path.

## Verification summary

- `pnpm check`: PASS, 47 files passed/4 skipped; 465 tests passed/10 skipped.
- Production build: PASS, 9 Workflow steps, 5 workflows, 13 pages.
- Local E2E: PASS, 14 passed/2 explicit live skips.
- Official fixture audit: PASS, 3/3.
- Production dependency audit: no known vulnerabilities. The full audit has
  zero high/critical findings and retains 1 low/3 moderate development-chain
  findings after scoped overrides.
- Vercel CLI remains pinned at 59.11.2; 33 focused runtime/provider attestation
  tests pass.
- Security re-review: `APPROVE`, P0=0/P1=0; both P2 recommendations were
  implemented and tested.
- Analysis Workflow claim/start/settlement ACK-loss fencing is implemented,
  focused-tested, and independently approved with P0=0, P1=0, and P2=0.
- One isolated provider-free Preview Workflow hard-kill canary passed platform
  redelivery. Its final verification re-read the existing run with start count
  zero; the log corroboration is explicitly deployment/window-bounded because
  the row contains no raw run ID. This does not prove the full application
  cleanup-recovery path.
- Production schema v9 is applied and probed; the matching application build is
  deployed and has current runtime/provider receipts.
- The five-document full reserve is USD 1.412123 and contains 24 generated
  function invocations; live Vercel usage remains unverified.

## Revalidation gate

1. Configure Turnstile, redeploy once, and store fresh runtime/provider
   receipts for that exact deployment.
2. Require health 200 and validate the deployed guest flow.
3. Continue observing Railway Cron and GitHub redundancy; health must remain
   fresh and no manual dispatch may be counted as scheduled evidence.
4. Run ten Edmonton analyses and one complete CER analysis under the existing
   budget caps, verify cleanup/cost/latency, and review at least 12 citations.
5. Complete the final video, contest submission, and five social publications.

S3, runtime, and provider receipts are scheduled for refresh on Sep 9 and
Sep 10 at 12:00 MDT. Until every gate passes, the release remains `NOT_READY`;
do not claim live readiness, provider retention/deletion, measured cost or
latency, video completion, contest submission, or social publication.

## Official references

- https://vercel.com/docs/fluid-compute
- https://vercel.com/docs/functions/configuring-functions/duration
- https://vercel.com/workflows
- https://docs.railway.com/guides/buckets
- https://docs.railway.com/guides/cron-workers-queues
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
