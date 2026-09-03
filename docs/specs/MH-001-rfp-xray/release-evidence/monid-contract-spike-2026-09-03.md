# Monid Contract Spike — 2026-09-03

This is a sanitized operator receipt. It contains no API key, signed URL,
source body, or downloaded Markdown. The tested source is the public Edmonton
solicitation `100022184-A`.

## Identity and budget

- `monid whoami --json` authenticated the intended Monid workspace.
- Wallet balance before paid work: USD 1.0000.
- Wallet balance after the two successful parses below: USD 0.9982.
- Total observed Monid charge: USD 0.0018.
- Failed ZDR and pre-run validation attempts consumed USD 0.

## Credentialed discovery and contract

`discover → inspect` selected the verified, stable `context.dev /parse`
endpoint. Discovery reported p50 4,317 ms and p95 6,065 ms. The inspected
request contract accepts a required `file_url` plus `extension`, `ocr`,
`includeLinks`, `includeImages`, `shortenBase64Images`,
`useMainContentOnly`, and `zdr`; the documented input ceiling is 25 MB.

Observed price:

- normal parse: USD 0.0009;
- OCR increment: USD 0.0036;
- maximum inspected parse price with OCR: USD 0.0045.

The canonical raw inspect response has SHA-256
`551283ef6526c09f276f4c2d82015168e083cdc348063521db1172c683384476`.
The release adapter is pinned to these response paths:

| Meaning | Path |
|---|---|
| run id | `runId` |
| lifecycle | `status` |
| nested provider HTTP status | `providerResponse.httpStatus` |
| Markdown artifact | `output.document.download_link` |
| charge | `cost.value` |
| currency | `cost.currency` |

Only `sfs.monid.ai` is permitted as an artifact host. Cost values use currency
major units and are converted to integer micro-USD in the application.

## Run receipts

| Probe | Monid run | Result | Cost | Sanitized observation |
|---|---|---|---:|---|
| ZDR capability | `01M1KT0104VGGWQZ7P3JK1W993` | provider 403 | USD 0 | `ZDR_NOT_ENABLED`; Context.dev directed the account to support to enable ZDR |
| Public Edmonton URL | `01M1KT158306QVQFDQ01CHJ41R` | provider 200 | USD 0.0009 | 6.448 s lifecycle; 144,275-byte Markdown |
| Railway five-minute signed GET URL | `01M1KTF9AXB6T9ZXJ0AK1WQGMX` | provider 200 | USD 0.0009 | artifact captured in 7.791 s; source cleanup confirmed in 8.140 s total |

Both successful parses produced the same Markdown SHA-256:
`6e8260b80df216fc0b3b8c1a87ed9c87ba1603bdcae8b82c57e82ad58b36ec56`.
The signed-URL probe used source SHA-256
`2a769c87c80d5e958b0c99d0bd0107b34cfbeddb9bb0c15c2f2b3dc609adc9c6`
and 1,726,637 bytes. After capture, conditional deletion succeeded and a
follow-up existence check confirmed that the Railway object was absent.

## Retention finding

Context.dev ZDR is not enabled for this workspace. The successful provider
response reported its parsed file expiring seven days after completion, while
the Monid download link itself was short-lived (approximately one hour). No
provider early-delete endpoint was found. Therefore:

- the application may promise and prove deletion only for copies it controls;
- the Web UI must disclose the observed seven-day upstream artifact expiry
  before a user submits a document and again in the audit view;
- confidential documents should not be submitted unless that retention is
  acceptable;
- enabling and re-verifying ZDR is required before making a zero-retention
  claim.

## Parsing quality finding

The Markdown preserved a useful semantic representation of the mandatory
table and other target language: M1–M4 were present, “up to three” was present,
the lowest-evaluated-price wording was retained without introducing a 70/30
rule, the security terms remained recoverable, and a Markdown table was
present. It did not preserve a trustworthy physical-page boundary: no form
feeds, page comments, page headings, or printed `N of 47` labels were emitted.

Monid is therefore accepted as a low-cost normalization input, not as citation
page truth. The local PDF.js physical-page index, source SHA, exact-quote
matcher, and fail-closed `needs_review` behavior remain authoritative.

## Decision

`GO`, with a privacy limitation. The integration is suitable for the public
competition sources and for user documents only after the seven-day upstream
retention disclosure is shown. The signed-URL compatibility, real charge, and
app-controlled cleanup gates passed. Production remains `NOT_READY` until the
deployment-bound provider receipt, Turnstile, end-to-end Edmonton/CER runs,
and final review gates close.
