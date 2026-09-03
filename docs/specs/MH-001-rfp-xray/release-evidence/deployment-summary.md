# Deployment Evidence Summary

Updated: 2026-09-03.

## Release identity and verdict

- Reviewed implementation commit: `dfc8be9`.
- Working tree at capture: documentation/evidence only, before its release
  commit and push.
- Public URL: https://rfp-xray.vercel.app.
- Public build: older sample that predates current release hardening.
- Verdict: `NOT_READY`.

The older landing, OpenAPI, Edmonton sample, and fail-closed health observations
remain reachability evidence only. They do not prove that the current build is
deployed. Chrome and in-app interactive browser control are unavailable.

## Current pre-deploy checks

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
| Deployment-bound runtime attestation | `APPROVE`, P0/P1/P2=0 | No current receipt until a clean committed deployment exists. |
| Deployment-bound provider contract | `APPROVE`, P0/P1/P2=0 | No receipt/call because Monid key and exact provider configuration are absent. |
| Security re-review | `APPROVE`, P0=0/P1=0 | Both P2 recommendations were implemented and tested afterward. |

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
`https://rfp-xray.vercel.app` as the Origin passed 1/1. Railway remains
storage-only; no Railway compute service exists. See
[railway-storage-probe.md](railway-storage-probe.md).

### Vercel runtime and maintenance

The Vercel project is configured for Node 22 and Fluid Compute. Current code
requires a deployment-bound attestation of the exact 300-second Workflow route
capability and associated deployment facts. The implementation is approved,
but a current receipt cannot be issued before the new committed deployment.

`CRON_SECRET` was rotated consistently in Vercel production/preview and GitHub
Actions. The GitHub maintenance variable remains intentionally false until the
new deployment. No successful production maintenance heartbeat is currently
claimed.

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
