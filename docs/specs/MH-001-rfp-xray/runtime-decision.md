# Runtime Decision: Vercel Fluid Compute + Railway Private Storage

Decided: 2026-09-03. Current evidence refreshed: 2026-09-03.

## Decision

Keep Web, API, Workflow execution, and durable application state on Vercel and
Neon. Use the dedicated Railway `rfp-xray-private` S3-compatible Bucket only for
short-lived private source objects. No Railway compute service was created, and
the unrelated `ontology-ai-ready` project was not modified.

This replaces the unavailable Vercel Private Blob dependency without adding a
second compute deployment. Railway compute remains a contingency only if real
provider timings cannot preserve the Vercel result-commit and cleanup headroom.

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
P0=0, P1=0, and P2=0. That is a code-review fact, not a live receipt. Reviewed
implementation commit `dfc8be9` is local and the public URL still serves the
older sample. A current runtime receipt therefore
does not yet exist and must not be fabricated or copied from an older build.

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

The active Neon database reports 9 public tables, 8 migration-ledger rows,
schema version 8, and marker `rfp-xray-schema-v8`. The live concurrency suite
passed 2/2, including a real compare-and-swap loss.

Recurring maintenance requires both a shared secret and a recent successful
bounded heartbeat. `CRON_SECRET` was rotated consistently in Vercel
production/preview and GitHub Actions. The GitHub maintenance variable remains
deliberately false until the new deployment exists; no production maintenance
heartbeat is currently claimed.

## Provider contract

Provider-contract attestation code received independent `APPROVE` with P0=0,
P1=0, and P2=0. It uses credentialed non-paid Monid inspect plus a non-paid
OpenAI control-plane check and binds the result to the same deployment identity.
No receipt or provider call exists because the Monid key and exact provider
configuration are absent. Production Turnstile is also absent.

## Why Railway remains storage-only

- Vercel owns HTTP routing, Workflow execution, observability, and recovery.
- Neon owns durable state, quotas, leases, costs, heartbeats, and attestations.
- Railway supplies private S3-compatible objects and signed browser ingress.
- Monid/context.dev remains the remote parsing candidate, so no always-on OCR
  or parser daemon is currently required.

Adding Railway compute now would add a second deployment, queue/restart policy,
secret surface, and cost ledger before measured evidence justifies it.

## Verification summary

- `pnpm check`: PASS, 39 files passed/3 skipped; 391 tests passed/7 skipped.
- Production build: PASS, 10 Workflow steps, 4 workflows, 13 pages.
- Local E2E: PASS, 14 passed/2 explicit live skips.
- Official fixture audit: PASS, 3/3.
- Production dependency audit: no known vulnerabilities. The full audit has
  zero high/critical findings and retains 1 low/3 moderate development-chain
  findings after scoped overrides.
- Vercel CLI remains pinned at 59.11.2; 33 focused runtime/provider attestation
  tests pass.
- Security re-review: `APPROVE`, P0=0/P1=0; both P2 recommendations were
  implemented and tested.

## Revalidation gate

1. Commit the documentation/evidence, push both local release commits, and inspect the exact new
   production deployment.
2. Store its deployment-bound runtime receipt and verify fail-closed health.
3. Enable GitHub maintenance only after deployment; require a successful
   bounded heartbeat.
4. Obtain Monid configuration and store a current provider-contract receipt
   before any source or paid call.
5. Configure production Turnstile and validate the deployed guest flow.
6. Run ten Edmonton analyses and one complete CER analysis under the existing
   budget caps, verify cleanup/cost/latency, and review at least 12 citations.

S3, runtime, and provider receipts are scheduled for refresh on Sep 9 and
Sep 10 at 12:00 MDT. Until every gate passes, the release remains `NOT_READY`;
do not claim live readiness, provider retention/deletion, measured cost or
latency, video completion, contest submission, or social publication.

## Official references

- https://vercel.com/docs/fluid-compute
- https://vercel.com/docs/functions/configuring-functions/duration
- https://vercel.com/workflows
- https://docs.railway.com/guides/buckets
