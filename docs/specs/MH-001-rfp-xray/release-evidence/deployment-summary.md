# Deployment Evidence Summary

Updated: 2026-09-03.

## Release identity and verdict

- Reviewed application commit: `fbb48d09bda4f8d671f6b1679c66d3e0400f45db`.
- Deployed release commit: `76e0f4e01f93d67eab4da9b98807959b81578396`.
- Public URL: https://rfp-xray.vercel.app.
- Captured production deployment: `dpl_5dMrPWKGMCKxy5hcQUfq57uLmZce`
  (`https://rfp-xray-3dpwofwgr-chendavs-projects.vercel.app`).
- Verdict: `NOT_READY`.

The landing, OpenAPI, Edmonton sample, runtime/provider receipts, maintenance
heartbeat, and fail-closed health were rechecked against the captured
deployment. They remain component/reachability evidence only; interactive
production citation review has not run.

## Current checks

| Check | Result |
|---|---|
| `pnpm check` | PASS: 44 files passed, 4 skipped; 423 tests passed, 10 skipped |
| Production build | PASS: 8 Workflow steps, 4 workflows, 13 pages |
| Local Playwright | PASS: 14 passed, 2 explicit live skips |
| Official fixture audit | PASS: 3/3 |
| Production dependency audit | PASS: no known vulnerabilities |
| Full dependency audit | PASS at high/critical gate: 0 high, 0 critical; 1 low and 3 moderate development-chain findings remain |
| Focused runtime/provider attestation tests | PASS: 33; Vercel CLI pinned at 59.11.2 |

## Independent implementation reviews

| Scope | Verdict | Boundary |
|---|---|---|
| Deployment-bound runtime attestation | `APPROVE`, P0/P1/P2=0 | Passed for captured deployment; refresh after Turnstile redeployment or expiry. |
| Deployment-bound provider contract | `APPROVE`, P0/P1/P2=0 | Passed for captured deployment; Monid and OpenAI are actively verified. |
| Security re-review | `APPROVE`, P0=0/P1=0 | Both P2 recommendations were implemented and tested afterward. |
| Maintenance scheduler | `APPROVE`, P0/P1/P2=0 | Railway proved seven scheduled cycles across more than 30 minutes; GitHub schedule remains unobserved redundancy. |
| Current candidate | `APPROVE`, P0/P1/P2=0 | Analysis-dispatch ACK-loss fence and final cost/retention evidence were independently reviewed. |

The conservative five-document full reserve is USD 1.412123 and includes 24
generated function invocations. It is estimated allocation evidence, not a
live Vercel invoice or usage receipt.

## Infrastructure component evidence

### Neon

The active resource reports 9 public tables, 9 migration-ledger rows, schema
version 9, and marker `rfp-xray-schema-v9`. The live concurrency suite passed
4/4, including real 16-way cleanup-retry and analysis-dispatch claim races. See
[neon-concurrency-probe.md](neon-concurrency-probe.md).

Schema v9 is applied to production and includes the permanent cleanup-retry
and analysis-dispatch claims exercised by the 4/4 live suite.

### Railway private storage

The target-bound storage attestation expires 2026-09-10 04:11:53 MDT. The
current S3 live test passed 1/1 and a real Chromium
PUT/read/fence/replay/delete probe with
`https://rfp-xray.vercel.app` as the Origin passed 1/1. Railway also hosts one
short-lived maintenance Cron trigger with no public domain and zero instances
between runs; it does not process RFPs. See
[railway-storage-probe.md](railway-storage-probe.md) and
[railway-maintenance-cron.md](railway-maintenance-cron.md).

### Vercel runtime and maintenance

The Vercel project is configured for Node 22 and Fluid Compute. Captured
deployment `dpl_5dMrPWKGMCKxy5hcQUfq57uLmZce` has a current attestation of the
300-second Workflow route capability. Its payload SHA-256 is
`5d50e812e28ee43fdc81bd99c8a2a291a737ff3c607ccb2d148cbba97aa14dbf`.
The exact deployment also has a provider-contract receipt with payload SHA-256
`0c8ede2c44fc3ff8038eea7640573bdef5cbbb0523ae7583e66b5e8f1743fe07`.
Both receipts are deployment-bound and must be refreshed after any subsequent
deployment or before their recorded expiry.

`CRON_SECRET` was rotated consistently in Vercel production/preview, GitHub
Actions, and Railway. GitHub manual run `33760198137` succeeded after rotation.
Railway Cron then produced seven consecutive bounded production heartbeats
across more than 30 minutes. No GitHub `event=schedule` run was observed, so it
is retained as redundancy rather than claimed as proven scheduled delivery.

## Price evidence

The official [bidworx pricing page](https://bidworx.io/pricing) was captured at
`2026-09-03T11:46:40.5885646Z`. The screenshot is 714876 bytes with SHA-256
`5a4d44ba608131cabb7770a28321d85d5552ba52fb4f86fb0b3520340b4f9b34`.
It supports only the visible claims “Starter £190/month” and typical usage of
one tender. See [bidworx pricing evidence](bidworx-pricing-2026-09-03.md).

## Monid contract evidence

Credentialed discovery/inspect pinned `context.dev /parse` and the canonical
inspect SHA-256. Two successful Edmonton parses cost USD 0.0009 each. One used
a five-minute Railway signed URL, captured byte-identical 144,275-byte
Markdown, and confirmed application-controlled source absence in 8.140 seconds.
The output had no trustworthy physical-page markers, so PDF.js remains citation
truth. Context.dev ZDR is unavailable for this workspace and its response
reported a seven-day upstream artifact expiry. See
[Monid contract spike](monid-contract-spike-2026-09-03.md).

## Open gates and evidence boundary

- Current candidate independent review: `APPROVE`, P0=0, P1=0, P2=0.
- Production schema v9 is applied, probed, and served by the matching release.
- Turnstile is absent.
- The next deployment caused by Turnstile configuration will require fresh
  runtime and provider-contract receipts.
- No real Edmonton ten-run benchmark or complete CER campaign has occurred.
- No end-to-end production Workflow recovery, cleanup timing, live cost,
  latency, retention/deletion, or citation click-through has been established.
- No final video, contest submission, or five-platform social publication has
  occurred.

The S3/runtime/provider receipt refresh heartbeat is scheduled for Sep 9 and
Sep 10 at 12:00 MDT; the refresh remains future work.

Do not promote local checks, independent code review, component probes, public
sample reachability, or the scheduled refresh into a production-ready or
contest-complete claim.
