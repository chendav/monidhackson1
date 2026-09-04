# T23 captured-response experiment

Date: 2026-09-04. Code baseline: `fc85c24b3b794126e3ca5c62d11483894acb97d7`.
Scope: cached official Edmonton PDF, physical page 14, supplied as PDF.js text.
No Monid call, production run, source-cleanup claim, or amendment test.

## Observations

One real `gpt-5.4-mini` response: 3,787 input tokens, 1,985 output tokens.
The entire test completed in 13.87 seconds. Model-token cost estimate using the
pinned application rate: USD 0.011773; this is not an invoice or an all-in run cost.

The response contained 11 records and 11 in-range citation selectors. Among ten
literal primary fields (excluding typed boolean `mandatory_gate`):

- Five values existed in the issued source fragment but not in the selected
  slice. Start-position errors were 2, 165, 9, 45 and 143 UTF-16 units.
- Four values were not verbatim in the source fragment. This is separate
  extractive-contract drift; offset repair alone does not establish their validity.
- One field was correctly located.

Concrete failure: the issuer field was `Canada`, while the selector chose
`th the`. The solicitation-number selector omitted its first two digits.

All 12 materializer citation receipts were exact physical PDF matches. All 11
authority records were nevertheless discarded because the one-page excerpt
retained the complete document's 55-page metadata, making coverage incomplete.
This experiment **does not prove the cause of every full CER rejection**.

## Reproducibility

The exact raw response, counted-token response, decoded draft, request hashes,
gate trace and source representation are saved in ignored local development
artifacts. Zero-network replay uses the real adapter and reconstructs its
process-local authority sidecar. Replay matched these capture hashes:

| Artifact | SHA-256 |
|---|---|
| decoded-extraction.json | `792ecc6b2cfd86fe3709a6a6147a960ba0ab998eaa0d3983410e43192e9a33d9` |
| materialize-trace.json | `8e64ba27088cc106e22c837e497924f792461f7307628a687fe42b6808592012` |
| materialized-result.json | `a92ab3e2f388050215e1a5d278681dc39496f4b9ecac8840c6f43fd79f78f5aa` |
| selector-measurements.json | `614225281897c7a89f2e1302383616a4bbb3bf4d59ea9ad3e48ca79985bf9181` |

Local artifact directory: `.data/diagnostic-targeted-openai-artifacts/`.
The live one-shot lock remains intact. No second paid call was made.

## Independent disposition

Reviewer: `authority_review`, independent from implementation.
Experiment execution gate: PASS. Migration hypothesis: ACCEPT, narrowly scoped
to eliminating model-calculated record-citation offsets through unique exact
source-quote positioning on the server. Full CER materialization remains an open
product acceptance gate. Submission relation offsets are unchanged by T24.
