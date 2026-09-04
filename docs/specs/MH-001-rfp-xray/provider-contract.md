# Provider Contract Baseline

Verified: 2026-09-03. This file records implementation constraints, not secrets.

## Monid

- CLI package: `@monid-ai/cli` 0.1.7; unscoped `monid` does not exist on npm.
- API base: `https://api.monid.ai`; authentication is a server-only Bearer key.
- Discover: `POST /v1/discover` with a bounded query and limit 5.
- Inspect: `POST /v1/inspect` with `{ provider, endpoint }`.
- Run: `POST /v1/run` with
  `{ provider, endpoint, input: { body?, queryParams?, pathParams? } }`.
- Poll: `GET /v1/runs/{runId}` until a terminal status. A lifecycle status of
  `COMPLETED` is accepted only when the nested provider HTTP status is 2xx.
- Settle cost from the terminal run's `cost.value` and `cost.currency`; preserve
  price/billing payloads opaquely because catalog schemas may drift.

## Context.dev parse through Monid

- Credentialed discovery and inspect selected verified/stable provider
  `context.dev` and endpoint `/parse`.
- Expected parse input is normalized inside the adapter and never leaks into the
  core domain: `file_url`, `extension`, `ocr`, `includeLinks:false`,
  `includeImages:false`, `shortenBase64Images:true`, `useMainContentOnly:false`.
- Provider presentation metadata describes a 25 MB input ceiling, but the
  inspect request schema exposes no byte-valued maximum and does not establish
  whether MB means decimal or binary units. The application therefore retains
  its existing 25 MiB ceiling as an explicitly unverified-unit risk rather than
  describing it as provider-verified. A successful parse returns a temporary
  Markdown download URL; download and validate the bytes immediately.
- Reserve 4,500 micro-USD when OCR is requested; terminal Monid cost is the
  authoritative settlement value.
- Credentialed execution proved that ZDR is not enabled for this workspace. A
  successful parse reported an upstream parsed-file expiry of seven days and a
  short-lived Monid download URL. No provider early-delete API was found. Claim
  only confirmed deletion of application-controlled copies and show the
  seven-day disclosure before submission.
- Do not use Monid SFS in the primary path because SFS objects do not auto-delete.

## Evidence boundary

- Monid normalizes the document; it does not determine citation page truth.
- A local PDF.js pass builds a 1-based physical-page index and source SHA.
- Models emit quote/chunk references, never page numbers.
- Server verification produces an append-only receipt containing source SHA,
  representation hash, fragment hash, physical page, method/version, and status.
- Source and temporary parse artifacts under application control are purged only
  after evidence verification; READY requires confirmed purge receipts.

## Credentialed gate results

1. PASS — exact inspect identity, recursive request validation, optional ZDR
   enum, and tiered USD prices are pinned by the shared versioned semantic
   SHA-256 projection. Configured response, lifecycle, cost-path, and artifact
   host settings remain separately bound by the deployment receipt.
2. PASS — Context.dev fetched a five-minute Railway signed GET URL; capture,
   conditional deletion, and absence confirmation completed in 8.140 seconds.
3. PASS WITH LIMITATION — Edmonton semantic content was useful, but Monid
   emitted no trustworthy physical-page boundaries. PDF.js remains citation
   truth.
4. PASS WITH LIMITATION — two successful runs cost USD 0.0009 each; upstream
   retention is observed at seven days because ZDR is unavailable.

## Current attestation status — 2026-09-03

The deployment-bound provider-contract attestation implementation received an
independent `APPROVE` with P0=0, P1=0, and P2=0. It binds a credentialed,
non-paid Monid inspect response and a non-paid OpenAI control-plane check to the
exact deployed release identity and a short TTL before source or paid work can
start.

Credentialed Monid discovery, inspect, ZDR capability testing, one public-URL
parse, and one Railway signed-URL parse have now run. The exact evidence is in
`release-evidence/monid-contract-spike-2026-09-03.md`. The application-controlled
source deletion gate passed; provider early deletion did not, and the UI must
disclose the observed seven-day provider expiry.

This does not replace the deployment-bound provider-contract receipt because
that receipt must also bind the exact production Git SHA/runtime deployment and
the OpenAI control-plane check. Production Turnstile is also absent. The
release remains `NOT_READY` and no end-to-end Edmonton/CER completion claim may
be made from this file.

The S3/runtime/provider receipt refresh heartbeat is scheduled for Sep 9 and
Sep 10 at 12:00 MDT. A provider refresh still needs the exact deployment and a
locally usable OpenAI credential in addition to the now-configured Monid key.
