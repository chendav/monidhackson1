# Chief Pre-Deploy Handoff

Updated: 2026-09-03.

## Assignment

Deliver a conservative RFP X-Ray release candidate and preserve an auditable
boundary between local implementation, live component probes, the public sample,
and still-missing live-provider/contest evidence.

## Current release identity

- Reviewed implementation commit: `dfc8be9`.
- The remaining working-tree changes are documentation/evidence and neither
  local release commit has been pushed yet.
- https://rfp-xray.vercel.app still serves the older sample build. It cannot be
  used as evidence for the current Railway, schema-v8, runtime-attestation,
  provider-attestation, or maintenance implementation.
- Current release verdict: `NOT_READY`.

## Architecture decisions

- Keep Web, API, and Workflow compute on Vercel, durable state on Neon, and
  short-lived private source objects in the dedicated Railway Bucket.
- Use no Railway compute unless measured provider timing proves the Vercel
  Fluid Compute envelope insufficient.
- Require target-bound, expiring storage, runtime, and provider contracts.
- Retain the closed-world product boundary: no tender search, embedded-link
  traversal, bid writing, data-network workflow, or unsupported bidder-fit
  prediction.
- Citation truth comes from the local source SHA/page/quote verifier, not from a
  model-authored page number or a Monid artifact alone.

## Verified pre-deploy evidence

- `pnpm check`: 39 files passed/3 skipped, 391 tests passed/7 skipped.
- Production build: PASS, 10 Workflow steps, 4 workflows, 13 pages.
- Local E2E: 14 passed/2 explicit live skips.
- Official fixture audit: 3/3.
- Production dependency audit: no known vulnerabilities; the full audit has
  zero high/critical findings and 1 low/3 moderate development-chain findings.
- Vercel CLI is pinned at 59.11.2; 33 focused runtime/provider attestation tests
  pass after scoped dependency overrides.
- Neon schema v8: 9 public tables, 8 migration rows, marker
  `rfp-xray-schema-v8`; live concurrency and real CAS-loss checks passed 2/2.
- Railway bound attestation expires 2026-09-10 04:11:53 MDT; current S3 live
  check passed 1/1 and a real Chromium production-Origin check passed 1/1.
- Vercel is configured for Node 22 and Fluid Compute.
- Runtime-attestation implementation: independent `APPROVE`, P0/P1/P2=0.
- Provider-contract attestation implementation: independent `APPROVE`,
  P0/P1/P2=0.
- Security re-review: `APPROVE`, P0=0/P1=0; both P2 recommendations are now
  implemented and tested.
- `CRON_SECRET` was rotated consistently in Vercel production/preview and
  GitHub Actions. GitHub maintenance deliberately remains disabled until the
  new deployment exists.

## Explicitly unverified

- No current deployment-bound runtime receipt exists.
- No provider-contract receipt or provider call exists because the Monid key
  and exact provider configuration are absent.
- Production Turnstile is absent.
- Chrome and in-app interactive browser control are unavailable.
- No paid Monid call, real Edmonton/CER campaign, live cleanup/cost/latency
  receipt, 12-citation production review, video, submission, or social
  publication has occurred.

## Price evidence

The official bidworx pricing screenshot is 714876 bytes, SHA-256
`5a4d44ba608131cabb7770a28321d85d5552ba52fb4f86fb0b3520340b4f9b34`,
captured at `2026-09-03T11:46:40.5885646Z`. It supports only the visible claims
that Starter is £190/month and typical usage is one tender.

## Next gates

1. Commit the reviewed documentation/evidence and push both local release
   commits; wait for the exact production build.
2. Verify the resulting deployment is bound to the final pushed Git SHA.
3. Create its deployment-bound runtime receipt and verify fail-closed health.
4. Enable maintenance and verify one bounded authenticated heartbeat.
5. Obtain Monid and Turnstile configuration; create the provider receipt before
   any source or paid call.
6. Run the budget-capped Edmonton/CER campaign and final independent deployed
   citation review.
7. Only then record the video, submit, and publish.

The release heartbeat will refresh the S3/runtime/provider receipts on Sep 9
and Sep 10 at 12:00 MDT.
