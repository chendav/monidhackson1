# Deployment Evidence Summary

Updated: 2026-09-03.

## Release identity and verdict

- Reviewed application commit: `f1b09e3d0b7f3f6570e61b1a0faeb72b2b85d455`.
- Working tree at capture: tested application/evidence candidate pending
  independent review, commit, and deployment.
- Public URL: https://rfp-xray.vercel.app.
- Captured production deployment: `dpl_md5xRevqZNJiDYG4Z6mtjWF4JCQd`
  (`https://rfp-xray-pgrtupsau-chendavs-projects.vercel.app`).
- Verdict: `NOT_READY`.

The landing, OpenAPI, Edmonton sample, runtime receipt, maintenance heartbeat,
and fail-closed health were rechecked against the captured deployment. They
remain component/reachability evidence only. Chrome and in-app interactive
browser control are unavailable.

## Current checks

| Check | Result |
|---|---|
| `pnpm check` | PASS: 44 files passed, 4 skipped; 421 tests passed, 10 skipped |
| Production build | PASS: 8 Workflow steps, 4 workflows, 13 pages |
| Local Playwright | PASS: 14 passed, 2 explicit live skips |
| Official fixture audit | PASS: 3/3 |
| Production dependency audit | PASS: no known vulnerabilities |
| Full dependency audit | PASS at high/critical gate: 0 high, 0 critical; 1 low and 3 moderate development-chain findings remain |
| Focused runtime/provider attestation tests | PASS: 33; Vercel CLI pinned at 59.11.2 |

## Independent implementation reviews

| Scope | Verdict | Boundary |
|---|---|---|
| Deployment-bound runtime attestation | `APPROVE`, P0/P1/P2=0 | Current for captured deployment; refresh after this evidence-only commit deploys. |
| Deployment-bound provider contract | `APPROVE`, P0/P1/P2=0 | Monid is configured/live-probed; exact candidate deployment and OpenAI-bound receipt remain open. |
| Security re-review | `APPROVE`, P0=0/P1=0 | Both P2 recommendations were implemented and tested afterward. |
| Maintenance scheduler | `APPROVE`, P0/P1/P2=0 | Railway proved seven scheduled cycles across more than 30 minutes; GitHub schedule remains unobserved redundancy. |
| Current candidate | `P2 PENDING` | Analysis-dispatch ACK-loss fence is implemented and focused-tested; current evidence synchronization still awaits Reviewer closure. |

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
deployment `dpl_md5xRevqZNJiDYG4Z6mtjWF4JCQd` had a current attestation of the
300-second Workflow route capability. The receipt is deployment-bound and must
be refreshed after this documentation-only release.

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
- Production schema v9 is applied and probed; deploy the matching candidate.
- The current candidate needs a new exact deployment and fresh runtime/provider
  attestations.
- Turnstile is absent.
- No exact-deployment/OpenAI-bound provider-contract receipt exists.
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
