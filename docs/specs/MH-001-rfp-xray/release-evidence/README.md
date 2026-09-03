# Release Evidence

This directory stores sanitized, durable release facts. It must never contain
credentials, database URLs, signed object URLs, raw tender PDFs, parsed tender
text, provider payloads, or wallet secrets.

## Current verdict

`NOT_READY_FOR_LIVE_PROVIDER_OR_CONTEST_COMPLETION`

Application commit `936041e8ca1ed626978ee8750ba640ef4975c4d9` is pushed and
was deployed at evidence capture. The public alias serves the current
fail-closed application. This evidence update will itself create a later
documentation-only deployment, which must receive a new deployment-bound
runtime receipt before source or paid work.

## Evidence classes

1. **Pre-deploy local candidate** — current checks pass: 39 test files and 391
   tests passed, with 3 files/7 tests explicitly skipped; build PASS with 10
   Workflow steps, 4 workflows, and 13 pages; local E2E 14/2; official fixtures
   3/3; no known production dependency vulnerabilities. The full audit has zero
   high/critical findings and 1 low/3 moderate development-chain findings.
2. **Independent implementation review** — runtime attestation and provider
   contract attestation each received `APPROVE`, P0/P1/P2=0. Security re-review
   received `APPROVE`, P0=0/P1=0, and both P2 recommendations were implemented
   and tested.
3. **Live component probes** — Neon schema/concurrency and Railway private
   storage passed their stated scopes. These are not end-to-end Monid evidence.
4. **Public sample** — current static/sample product surface only; it is not a
   live-provider execution.
5. **Live-provider release** — not ready and not executed.

## Current live component facts

- Neon: 9 public tables, 8 migration rows, schema v8 marker; live concurrency
  and real CAS-loss suite passed 2/2.
- Railway: bound attestation expires 2026-09-10 04:11:53 MDT; S3 live 1/1 and
  real Chromium production-Origin flow 1/1. Its separate short-lived
  maintenance Cron completed three consecutive five-minute cycles; Railway
  runs no RFP analysis worker and has zero instances between cron invocations.
- Vercel settings: Node 22 and Fluid Compute. Deployment
  `dpl_EW9Bt6QLnhbMSwhEL5yY3AaJ64GE` had a current deployment-bound runtime
  receipt at capture; the next evidence-only deployment requires a new one.
- Provider contract: implementation approved, but no receipt or call exists
  because the Monid key/configuration is absent.
- Maintenance: shared secret rotated consistently across Vercel, GitHub, and
  Railway. Railway scheduled delivery is proven for three cycles. GitHub
  manual dispatch works, but its `schedule` event was not observed and is
  treated only as redundancy.

## Durable artifacts

- [Deployment summary](deployment-summary.md)
- [Neon schema/concurrency probe](neon-concurrency-probe.md)
- [Railway private-storage probe](railway-storage-probe.md)
- [Railway maintenance Cron probe](railway-maintenance-cron.md)
- [bidworx pricing evidence](bidworx-pricing-2026-09-03.md)
- `bidworx-pricing-2026-09-03.png` — 714876 bytes; SHA-256
  `5a4d44ba608131cabb7770a28321d85d5552ba52fb4f86fb0b3520340b4f9b34`.

## Open gates

Turnstile is absent. Chrome/in-app interactive browser control is unavailable.
No paid Monid call, real Edmonton/CER campaign, end-to-end deployed cleanup,
provider retention/deletion proof, production citation review, final video,
contest submission, or social publication has occurred.

The S3/runtime/provider receipt refresh heartbeat is scheduled for Sep 9 and
Sep 10 at 12:00 MDT. A schedule is not evidence that a refresh succeeded.
