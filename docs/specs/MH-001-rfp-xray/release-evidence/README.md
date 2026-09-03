# Release Evidence

This directory stores sanitized, durable release facts. It must never contain
credentials, database URLs, signed object URLs, raw tender PDFs, parsed tender
text, provider payloads, or wallet secrets.

## Current verdict

`NOT_READY_FOR_LIVE_PROVIDER_OR_CONTEST_COMPLETION`

Application commit `fbb48d09bda4f8d671f6b1679c66d3e0400f45db` and release commit
`76e0f4e01f93d67eab4da9b98807959b81578396` are pushed. The public alias
serves that reviewed fail-closed release. Exact-deployment runtime and
Monid/OpenAI provider receipts both passed. The Turnstile widget and Vercel
Production values are configured, but the current deployment predates them;
redeployment and real campaign gates still prevent public source or paid work.

Local reviewed implementation `4089397de8f2cfc3dc4846911bd9767adea178f4`
includes the independently approved watchdog-reclaim fence, provider-free
Workflow redelivery proof, and reproducible read-only Vercel log-receipt
generator. It is intentionally not pushed or deployed until it can ship with
the Turnstile configuration. Video scaffold
`fc054660aab99dbb46128a7d519bf1885f43ad5a` is also local-only;
its evidence gate is supposed to fail until the real campaign supplies every
capture and measured value.

## Evidence classes

1. **Pre-deploy local candidate** — current checks pass: 47 test files and 465
   tests passed, with 4 files/10 tests explicitly skipped; build PASS with 9
   Workflow steps, 5 workflows, and 13 pages; local E2E 14/2; official fixtures
   3/3; no known production dependency vulnerabilities. The full audit has zero
   high/critical findings and 1 low/3 moderate development-chain findings.
2. **Independent implementation review** — runtime attestation and provider
   contract attestation each received `APPROVE`, P0/P1/P2=0. Security re-review
   received `APPROVE`, P0=0/P1=0, and both earlier P2 recommendations were
   implemented and tested. The current candidate's analysis-dispatch ACK-loss
   fence is focused-tested and independently approved with P0=0, P1=0, and
   P2=0. The current local candidate adds the independently approved watchdog-
   reclaim fence and provider-free redelivery verifier (P0=0, P1=0). The video
   evidence gate is separately approved P0=0/P1=0 and currently blocks all
   canonical build/render/publish commands on 23 real open markers.
3. **Live recovery canary** — one isolated provider-free Preview run received
   a literal `SIGKILL` and completed through same-step platform redelivery. Its
   final verifier was read-only with `workflow_start_count=0`; this does not
   prove full application cleanup recovery. The separately reviewed v2 log
   receipt is deployment/window-bounded, not exact-run-bound. Its unsalted
   hashes are local-receipt pseudonymization, not anonymity. The earlier local
   v1 receipt and hash are superseded and must not be cited.
4. **Live component probes** — Neon schema/concurrency, Railway private
   storage, and the Monid contract spike passed their stated scopes. These are
   not complete production campaign evidence.
5. **Public sample** — current static/sample product surface only; it is not a
   live-provider execution.
6. **Live-provider release** — not ready and not executed.

## Current live component facts

- Neon: 9 public tables, 9 migration rows, schema v9 marker; live concurrency
  passed 4/4, including real 16-way cleanup-retry and analysis-dispatch claim
  races.
- Railway: bound attestation expires 2026-09-10 04:11:53 MDT; S3 live 1/1 and
  real Chromium production-Origin flow 1/1. Its separate short-lived
  maintenance Cron completed seven consecutive five-minute cycles across more
  than 30 minutes; Railway
  runs no RFP analysis worker and has zero instances between cron invocations.
- Vercel settings: Node 22 and Fluid Compute. Deployment
  `dpl_5dMrPWKGMCKxy5hcQUfq57uLmZce` has current deployment-bound runtime and
  provider-contract receipts. Their payload SHA-256 values are
  `5d50e812e28ee43fdc81bd99c8a2a291a737ff3c607ccb2d148cbba97aa14dbf` and
  `0c8ede2c44fc3ff8038eea7640573bdef5cbbb0523ae7583e66b5e8f1743fe07`.
- Provider contract: exact Monid configuration is stored in Vercel and two
  credentialed Edmonton parses passed at USD 0.0009 each. One proved a
  five-minute Railway signed URL plus confirmed source cleanup in 8.140 seconds.
  The exact deployment/OpenAI-bound provider receipt passed.
- Retention: Context.dev ZDR is unavailable for this workspace and a successful
  response reported a seven-day upstream artifact expiry. No provider early-
  delete API is known; this is disclosed separately from app-controlled cleanup.
- Maintenance: shared secret rotated consistently across Vercel, GitHub, and
  Railway. Railway scheduled delivery is proven for seven cycles. GitHub
  manual dispatch works, but its `schedule` event was not observed and is
  treated only as redundancy.
- Cost envelope: 24 generated function invocations and USD 1.412123 for the
  conservative five-document full reserve. This is estimated allocation, not
  a provider receipt.

## Durable artifacts

- [Deployment summary](deployment-summary.md)
- [Current production status](production-status-2026-09-03.md)
- [Neon schema/concurrency probe](neon-concurrency-probe.md)
- [Railway private-storage probe](railway-storage-probe.md)
- [Railway maintenance Cron probe](railway-maintenance-cron.md)
- [bidworx pricing evidence](bidworx-pricing-2026-09-03.md)
- [Monid contract spike](monid-contract-spike-2026-09-03.md)
- [Workflow recovery canary](workflow-recovery-canary-2026-09-03.md)
- [Infrastructure cost estimate contract](infrastructure-cost-estimates-2026-09-03.md)
- `bidworx-pricing-2026-09-03.png` — 714876 bytes; SHA-256
  `5a4d44ba608131cabb7770a28321d85d5552ba52fb4f86fb0b3520340b4f9b34`.

## Open gates

Turnstile is configured but not yet present in a deployed build, and its live
challenge has not run. Interactive production citation review has not run.
The two paid Monid calls are bounded contract-spike evidence, not the real
Edmonton/CER campaign. The Turnstile-triggered redeployment and renewed
attestations, paid Edmonton/CER
campaigns, end-to-end cleanup/cost/latency proof, at least 12 production
citation clicks, final video, contest submission, and five social publications
remain open.

The S3/runtime/provider receipt refresh heartbeat is scheduled for Sep 9 and
Sep 10 at 12:00 MDT. A schedule is not evidence that a refresh succeeded.
