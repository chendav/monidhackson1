# Deployment Evidence Summary

Updated: 2026-09-03.

## Release identity and verdict

- Reviewed application commit: `936041e8ca1ed626978ee8750ba640ef4975c4d9`.
- Working tree at capture: documentation/evidence update only; application
  source is unchanged.
- Public URL: https://rfp-xray.vercel.app.
- Captured production deployment: `dpl_EW9Bt6QLnhbMSwhEL5yY3AaJ64GE`
  (`https://rfp-xray-oyfo3261w-chendavs-projects.vercel.app`).
- Verdict: `NOT_READY`.

The landing, OpenAPI, Edmonton sample, runtime receipt, maintenance heartbeat,
and fail-closed health were rechecked against the captured deployment. They
remain component/reachability evidence only. Chrome and in-app interactive
browser control are unavailable.

## Current checks

| Check | Result |
|---|---|
| `pnpm check` | PASS: 39 files passed, 3 skipped; 391 tests passed, 7 skipped |
| Production build | PASS: 10 Workflow steps, 4 workflows, 13 pages |
| Local Playwright | PASS: 14 passed, 2 explicit live skips |
| Official fixture audit | PASS: 3/3 |
| Production dependency audit | PASS: no known vulnerabilities |
| Full dependency audit | PASS at high/critical gate: 0 high, 0 critical; 1 low and 3 moderate development-chain findings remain |
| Focused runtime/provider attestation tests | PASS: 33; Vercel CLI pinned at 59.11.2 |

## Independent implementation reviews

| Scope | Verdict | Boundary |
|---|---|---|
| Deployment-bound runtime attestation | `APPROVE`, P0/P1/P2=0 | Current for captured deployment; refresh after this evidence-only commit deploys. |
| Deployment-bound provider contract | `APPROVE`, P0/P1/P2=0 | No receipt/call because Monid key and exact provider configuration are absent. |
| Security re-review | `APPROVE`, P0=0/P1=0 | Both P2 recommendations were implemented and tested afterward. |
| Maintenance scheduler | `APPROVE`, P0/P1/P2=0 | Railway proved three scheduled cycles; GitHub schedule remains unobserved redundancy. |

## Infrastructure component evidence

### Neon

The active resource reports 9 public tables, 8 migration-ledger rows, schema
version 8, and marker `rfp-xray-schema-v8`. The live concurrency suite passed
2/2, including a real compare-and-swap loss. See
[neon-concurrency-probe.md](neon-concurrency-probe.md).

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
deployment `dpl_EW9Bt6QLnhbMSwhEL5yY3AaJ64GE` had a current attestation of the
300-second Workflow route capability. The receipt is deployment-bound and must
be refreshed after this documentation-only release.

`CRON_SECRET` was rotated consistently in Vercel production/preview, GitHub
Actions, and Railway. GitHub manual run `33760198137` succeeded after rotation.
Railway Cron then produced three consecutive bounded production heartbeats at
13:19, 13:24, and 13:29 UTC. No GitHub `event=schedule` run was observed, so it
is retained as redundancy rather than claimed as proven scheduled delivery.

## Price evidence

The official [bidworx pricing page](https://bidworx.io/pricing) was captured at
`2026-09-03T11:46:40.5885646Z`. The screenshot is 714876 bytes with SHA-256
`5a4d44ba608131cabb7770a28321d85d5552ba52fb4f86fb0b3520340b4f9b34`.
It supports only the visible claims “Starter £190/month” and typical usage of
one tender. See [bidworx pricing evidence](bidworx-pricing-2026-09-03.md).

## Open gates and evidence boundary

- Turnstile is absent.
- No paid Monid/provider call or provider-contract receipt exists.
- No real Edmonton ten-run benchmark or complete CER campaign has occurred.
- No end-to-end production Workflow recovery, cleanup timing, live cost,
  latency, retention/deletion, or citation click-through has been established.
- No final video, contest submission, or social publication has occurred.

The S3/runtime/provider receipt refresh heartbeat is scheduled for Sep 9 and
Sep 10 at 12:00 MDT; the refresh remains future work.

Do not promote local checks, independent code review, component probes, public
sample reachability, or the scheduled refresh into a production-ready or
contest-complete claim.
