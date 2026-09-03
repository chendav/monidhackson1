# Release Evidence

This directory stores sanitized, durable release facts. It must never contain
credentials, database URLs, signed object URLs, raw tender PDFs, parsed tender
text, provider payloads, or wallet secrets.

## Current verdict

`NOT_READY_FOR_LIVE_PROVIDER_OR_CONTEST_COMPLETION`

Application commit `f1b09e3d0b7f3f6570e61b1a0faeb72b2b85d455` is pushed and
was deployed at evidence capture. The public alias serves that fail-closed
baseline. The current tested candidate changes application behavior and must
receive independent review, a commit, a new deployment-bound runtime receipt,
and a provider receipt before public source or paid work.

## Evidence classes

1. **Pre-deploy local candidate** — current checks pass: 44 test files and 421
   tests passed, with 4 files/10 tests explicitly skipped; build PASS with 8
   Workflow steps, 4 workflows, and 13 pages; local E2E 14/2; official fixtures
   3/3; no known production dependency vulnerabilities. The full audit has zero
   high/critical findings and 1 low/3 moderate development-chain findings.
2. **Independent implementation review** — runtime attestation and provider
   contract attestation each received `APPROVE`, P0/P1/P2=0. Security re-review
   received `APPROVE`, P0=0/P1=0, and both earlier P2 recommendations were
   implemented and tested. The current candidate's analysis-dispatch ACK-loss
   fence is focused-tested and independently approved with P0=0, P1=0, and
   P2=0.
3. **Live component probes** — Neon schema/concurrency, Railway private
   storage, and the Monid contract spike passed their stated scopes. These are
   not complete production campaign evidence.
4. **Public sample** — current static/sample product surface only; it is not a
   live-provider execution.
5. **Live-provider release** — not ready and not executed.

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
  `dpl_md5xRevqZNJiDYG4Z6mtjWF4JCQd` had a current deployment-bound runtime
  receipt at capture; the next evidence-only deployment requires a new one.
- Provider contract: exact Monid configuration is stored in Vercel and two
  credentialed Edmonton parses passed at USD 0.0009 each. One proved a
  five-minute Railway signed URL plus confirmed source cleanup in 8.140 seconds.
  The exact deployment/OpenAI-bound provider receipt remains open.
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
- [Neon schema/concurrency probe](neon-concurrency-probe.md)
- [Railway private-storage probe](railway-storage-probe.md)
- [Railway maintenance Cron probe](railway-maintenance-cron.md)
- [bidworx pricing evidence](bidworx-pricing-2026-09-03.md)
- [Monid contract spike](monid-contract-spike-2026-09-03.md)
- [Infrastructure cost estimate contract](infrastructure-cost-estimates-2026-09-03.md)
- `bidworx-pricing-2026-09-03.png` — 714876 bytes; SHA-256
  `5a4d44ba608131cabb7770a28321d85d5552ba52fb4f86fb0b3520340b4f9b34`.

## Open gates

Turnstile is absent. Chrome/in-app interactive browser control is unavailable.
The two paid Monid calls are bounded contract-spike evidence, not the real
Edmonton/CER campaign. The new exact deployment and attestations, Turnstile,
paid Edmonton/CER
campaigns, end-to-end cleanup/cost/latency proof, at least 12 production
citation clicks, final video, contest submission, and five social publications
remain open.

The S3/runtime/provider receipt refresh heartbeat is scheduled for Sep 9 and
Sep 10 at 12:00 MDT. A schedule is not evidence that a refresh succeeded.
