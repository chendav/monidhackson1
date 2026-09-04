# T26 independent harness review

## Verdict

**ACCEPT** for the bounded one-shot local capture. This is authorization for
the staged Monid caches and one model package only; it is not production,
cleanup, CER-golden, or full-product approval.

The signed-source delta introduced after the official endpoint returned HTTP
403 is also **ACCEPTED**. The 403 occurred before Monid paid dispatch; no Monid
source lock, cache, or spend was created by that attempt.

## Paid-call and cache boundaries

- The four inputs are fixed repository CER documents. Local bytes are checked
  against their pinned SHA-256, byte length, and physical page count before
  staging. The blocked official URL is not retried.
- Staging uses the validated Railway-managed S3 endpoint. The shared control
  probe fails closed unless bucket versioning was never enabled, Object Lock is
  absent/disabled, and the expected CORS contract matches.
- Each source gets a new random `probe/cer-v8-cache/` key saved locally before
  upload for interruption recovery. Upload uses `IfNoneMatch: *`, one SDK
  attempt, the pinned local bytes, and bounded aborts. HEAD must reproduce the
  PUT ETag and exact byte length before a 300-second signed GET is created.
- The signed GET exists only in memory and is never written to artifacts. The
  cache stores source/Markdown hashes, sanitized Monid cost provenance, and
  hashes—not bodies or URLs—of terminal control data.
- A `finally` block deletes only the exact random key, conditionally on the PUT
  ETag when available, and requires a subsequent HEAD 404. A per-source cleanup
  receipt is written even on failure; absent/unconfirmed cleanup blocks all
  model work. Bucket controls rule out retained object versions, but this remains
  a local signed-source probe rather than production Workflow cleanup evidence.
- Monid validates the current credentialed cost contract before parsing. Each
  source has an immutable cache and a separate `wx` permanent paid-dispatch
  lock created immediately before `/v1/run`; a missing cache with an existing
  lock cannot dispatch again.
- Successful Markdown is written immediately with source/Markdown hashes and
  sanitized cost provenance. Temporary artifact URLs and terminal bodies are
  not retained; only the terminal-body hash is stored. Failure artifacts are
  body-free and explicitly prohibit automatic retry.
- Model live mode requires a separate explicit acknowledgement and permanent
  package lock. The adapter is limited to five unique inputs, uses SDK
  `maxRetries: 0`, caches token counts and each raw response immediately, and
  rejects duplicate input hashes.
- The aggregate configured maximum is 320k input tokens plus 50k output tokens,
  approximately USD 0.465 under the repository estimator. The pre-dispatch
  callback requires current-plus-remaining maximum cost to stay at or below
  USD 0.50.
- Replay constructs neither a Monid nor OpenAI live client for provider work;
  it requires exact request metadata/hash matches against the local caches.
- Full Markdown and model bodies remain only under ignored local `.data` paths.
  The harness explicitly records that a temporary remote probe copy was made,
  labels manifest cleanup status synthetic, and disclaims production cleanup
  evidence.

Offline prepare passed 1/1 and produced five provisional batches. No paid or
network call was made by this review.

## Resolved provenance correction

The four pinned files contain **75 physical pages**, not 79:

- base: 58
- Amendment 001: 6
- Amendment 002: 2
- Amendment 003: 9

The harness validates these per-document counts correctly, the prepared
artifact records them correctly, and `t26-experiment.md` now states 75. The
earlier discrepancy is closed.

## Post-capture addendum: Monid and raw OpenAI wire cache

The completed Monid stage is **ACCEPTED as bounded local evidence**:

- Exactly four immutable Markdown caches exist, one for each pinned CER SHA.
  Their stored Markdown hashes recompute correctly.
- Every cache reports a credentialed-inspect cost of USD 0.0009 in
  `currency_major` units, for USD 0.0036 total. All four receipts use the same
  pinned inspect-schema hash and explicit value/currency paths.
- Exactly four cleanup receipts correspond to those source SHAs. Every upload
  succeeded, every exact-key deletion was confirmed by the required post-delete
  404, and capture-to-delete latency was 345–403 ms.
- The storage receipt confirms versioning was never enabled, Object Lock is
  absent, and the reviewed CORS contract is present.
- No earlier paid source cache or lock is present. The current permanent locks
  correspond to the successful final capture and prevent repeat spend.

The added OpenAI fetch wrapper is also **ACCEPTED**. It wraps the SDK's single
underlying `fetch`, clones that response, and saves the clone before SDK parsing;
it does not issue a second HTTP request. The artifact identity hashes URL and
request body, while the saved object contains status and response text only—no
request headers or credentials. The existing writer rejects known OpenAI or
Monid secrets. SDK retries and package/batch limits remain unchanged. This
local raw-wire cache may contain public tender text and is neither production
logging nor public evidence.

No conclusion about the still-running model result, CER goldens, deployment,
or full-product readiness is included in this addendum.
