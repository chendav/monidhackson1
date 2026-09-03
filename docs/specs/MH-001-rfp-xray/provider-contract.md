# Provider Contract Baseline

Verified: 2026-09-02. This file records implementation constraints, not secrets.

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

- Provider/endpoint are configuration values confirmed by credentialed inspect.
- Expected parse input is normalized inside the adapter and never leaks into the
  core domain: `file_url`, `extension`, `ocr`, `includeLinks:false`,
  `includeImages:false`, `shortenBase64Images:true`, `useMainContentOnly:false`.
- Public documentation states a 25MB input limit and returns a temporary
  Markdown download URL. Download and validate the bytes immediately.
- Reserve 4,500 micro-USD when OCR is requested; terminal Monid cost is the
  authoritative settlement value.
- No public Monid run DELETE, run-retention TTL, or parsed-artifact early-delete
  API has been verified. Do not claim provider deletion or ZDR without a live
  account-visible proof.
- Do not use Monid SFS in the primary path because SFS objects do not auto-delete.

## Evidence boundary

- Monid normalizes the document; it does not determine citation page truth.
- A local PDF.js pass builds a 1-based physical-page index and source SHA.
- Models emit quote/chunk references, never page numbers.
- Server verification produces an append-only receipt containing source SHA,
  representation hash, fragment hash, physical page, method/version, and status.
- Source and temporary parse artifacts under application control are purged only
  after evidence verification; READY requires confirmed purge receipts.

## Credentialed gates still required

1. Inspect the exact context.dev parse schema, price, and optional ZDR field.
2. Prove Context.dev can fetch a five-minute Vercel Private Blob signed GET URL.
3. Compare Edmonton parsing against local PDF.js page coverage and golden facts.
4. Record actual cost and provider retention disclosure without exposing inputs.
