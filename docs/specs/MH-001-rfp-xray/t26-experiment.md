# T26 real CER cache capture

Purpose: establish one genuine current v8 CER result using real Monid Markdown,
and keep the raw local provider responses so subsequent defects are replayable.
No production algorithm change is part of this experiment.

## Captured outcome

All4Monid calls and all5v8 model calls completed and their genuine artifacts are
cached. Monid actualUSD0.0036; model168503input/41149output tokens, per-batch
rounded estimateUSD0.311550. Total actual-plus-estimatedUSD0.315150 excludes
marginal storage/local-compute costs. Monid phase34.10s, model-test164.17s.
Every staged PDF was deleted/Head404, captured-to-delete345–403ms; the complete
provider capture is therefore available without further parser/model calls.

Local acceptance failed: a269326-byte ephemeral authority manifest exceeded
the262144 cap and was replaced by the empty fallback. This is recorded as a
failure, not a successful CER/production run. T27 addresses only this measured
capacity defect; see t27-reframing.md. Original batch responses remain immutable.

## Signed-source delta after read-only official HTTP403

The first execution reached credentialed inspect but official PDF fetch returned
403 before any paid Monid dispatch (no source lock/cache created). Do not retry
the public-site download. Use the same pinned local bytes via the existing
Railway S3 integration: verify versioning never enabled/Object Lock absent and
CORS, create one UUID probe object per PDF using IfNoneMatch:*, verify ETag/size,
then give Monid only a300-second signed GET. Persist an ignored object key for
interruption recovery, never the signed URL. Capture Markdown before finally
deleting that exact object (IfMatch when available) and verifying Head404.
Record per-source upload/deletion evidence and captured-to-delete time. Missing
cleanup receipt blocks model execution; SDK storage retries are disabled.
This replaces the direct official URL/no-remote-copy assumptions below.
It is a local signed-source probe, not production Workflow cleanup evidence.

Harness: `.data/diagnostic-package-cer-v8.test.ts` and matching config. The four
pinned PDFs are deliberately supplied003/base/001/002. Preparation verified
75physical pages and produced five provisional PDF.js-source batches; this is
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

Source files are public, retained locally by user instruction. Temporary private
probe copies require separate deletion receipts; no production READY is claimed.
Pinned bytes are staged directly, avoiding a direct-source check/use gap.
Production Workflow cleanup verification remains separate. Synthetic manifests are
explicitly labelled component-only and never used as release cleanup evidence.

Expected evidence: real raw batches, Monid Markdown hashes/receipts, decoded
records, first materialization gates, independent citation checks and the
existing CER golden validator. Any failure is diagnosed from this cache, not
retried as another full paid package.
