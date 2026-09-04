# T26 real CER cache capture

Purpose: establish one genuine current v8 CER result using real Monid Markdown,
and keep the raw local provider responses so subsequent defects are replayable.
No production algorithm change is part of this experiment.

Harness: `.data/diagnostic-package-cer-v8.test.ts` and matching config. The four
pinned PDFs are deliberately supplied003/base/001/002. Preparation verified
79physical pages and produced five provisional PDF.js-source batches; this is
not yet the actual Monid request plan.

Stages are explicit: prepare (offline), monid (four source captures), prepare
(actual cached Markdown plan), live (one model package), replay (offline).
Monid first checks the current credentialed inspect contract, fetches each
allowlisted official source with redirect:error and compares bytes/SHA to the
local pin. It accepts the official HTTPS URL and caches Markdown immediately.
Each source has a permanent paid-dispatch lock; completed caches are not
overwritten. Receipts retain hashes, actual amount/unit/currency/provenance,
but never keys, temporary artifact URLs or raw terminal payloads.

The model capture uses at most five unique batches, maxRetries0, one permanent
package lock, and a USD0.50 model reservation. Genuine token-count and parsed
response values are saved before adapter decoding and reused by exact request
metadata/hash. Replay constructs no live client and may not modify model facts.
Monid is separately billed and must retain actual cost receipts; the user's
development daily-cap waiver applies, not the public product's budgets.

Source files are public, retained locally by user instruction. No application
remote copy is created, so no production deletion/READY proof is claimed.
Direct official URL input has a disclosed check/use identity gap; production
signed-source cleanup verification remains separate. Synthetic manifests are
explicitly labelled component-only and never used as release cleanup evidence.

Expected evidence: real raw batches, Monid Markdown hashes/receipts, decoded
records, first materialization gates, independent citation checks and the
existing CER golden validator. Any failure is diagnosed from this cache, not
retried as another full paid package.
