# Edmonton Parser Benchmark

This benchmark answers one narrow question: does Monid/context.dev add enough
normalization quality over the local PDF.js path to justify using it in the
primary ingestion route? It does not score downstream model reasoning.

## Fixed input

- Official source: Edmonton solicitation `100022184-A`.
- Expected physical pages: 55.
- Expected printed body terminal label: `47 of 47` before eight form pages.
- Source identity is fixed by SHA-256 immediately after download.
- Both candidates receive identical bytes; neither follows embedded links.

## Candidates

1. `local`: PDF.js physical-page text index and form metadata available from the
   source PDF.
2. `monid`: context.dev parse through Monid, immediately downloaded and aligned
   back to the same PDF.js physical-page index.

The ontology-inspired verifier is common to both candidates. It is not part of
the parser comparison.

## Scored checks

| Check | Weight | Pass condition |
|---|---:|---|
| Physical page coverage | 20 | All 55 physical pages remain addressable |
| Mandatory table | 20 | Page 43 yields exactly M1–M4; M3 preserves “up to three” |
| Award method | 10 | Page 14 keeps lowest evaluated price separate from 70/30 |
| Security distinctions | 10 | Pages 15–17 preserve AFR, organizational DOS, and personnel Reliability Status |
| Cross-reference anomaly | 10 | Page 17 “Annex D” can be compared with actual Annex E |
| Blank pricing cells | 10 | Pages 40–42 remain blank/null, never zero |
| Form-page preservation | 10 | Pages 48–55 are not dropped as post-body noise |
| Quote recoverability | 10 | Golden evidence quotes can be uniquely recovered on their physical page |

Score is the weighted percentage of deterministic assertions passed. OCR is
scored in a separate scanned-fixture test and does not improve the native-PDF
score merely by being enabled.

## Operational measurements

Record without source text:

- wall-clock parse and artifact-download time;
- provider lifecycle and nested HTTP result;
- Monid actual cost and any retries;
- output bytes and page/chunk counts;
- signed-URL compatibility;
- observed artifact TTL and disclosed retention unknowns;
- cleanup receipts for every application-controlled object.

## Decision rule

- Prefer Monid as primary normalization only if it passes every critical check
  (mandatory table, blank pricing, form pages, quote recovery) and improves the
  total score or scanned/table fixtures materially.
- Prefer local normalization when scores are tied and Monid adds latency,
  retention exposure, or failure modes without measurable extraction gain.
- A competition integration requirement may still execute a clearly labeled,
  budget-capped Monid step; it cannot be described as the source of citation
  truth unless the benchmark supports that claim.
- Any provider result lacking a downloadable artifact, valid nested 2xx status,
  cost settlement, or reliable alignment is a failed candidate rather than a
  partial success.

## Evidence status

The local deterministic suite can run without credentials. The Monid column
remains `not_run` until a credentialed `discover → inspect → run` probe is
available. No winner is declared before both columns use the same source hash.
