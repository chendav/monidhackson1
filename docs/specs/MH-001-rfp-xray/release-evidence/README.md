# Release Evidence

This directory stores sanitized, durable release facts. It must never contain
credentials, database URLs, signed object URLs, raw tender PDFs, parsed tender
text, provider payloads, or wallet secrets.

## Current verdict

`NOT_READY_FOR_LIVE_PROVIDER_OR_CONTEST_COMPLETION`

Reviewed implementation commit `dfc8be9` is local. The release commits have not
yet been pushed, so https://rfp-xray.vercel.app still serves the older sample build.
The public sample cannot evidence the current schema-v8, Railway,
runtime-attestation, provider-attestation, or maintenance paths.

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
4. **Public sample** — an older static/sample product surface only.
5. **Live-provider release** — not ready and not executed.

## Current live component facts

- Neon: 9 public tables, 8 migration rows, schema v8 marker; live concurrency
  and real CAS-loss suite passed 2/2.
- Railway: bound attestation expires 2026-09-10 04:11:53 MDT; S3 live 1/1 and
  real Chromium production-Origin flow 1/1.
- Vercel settings: Node 22 and Fluid Compute. No deployment-bound runtime
  receipt exists until the clean committed deployment is available.
- Provider contract: implementation approved, but no receipt or call exists
  because the Monid key/configuration is absent.
- Maintenance: shared secret rotated consistently; GitHub variable remains
  intentionally false until the new deployment.

## Durable artifacts

- [Deployment summary](deployment-summary.md)
- [Neon schema/concurrency probe](neon-concurrency-probe.md)
- [Railway private-storage probe](railway-storage-probe.md)
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
