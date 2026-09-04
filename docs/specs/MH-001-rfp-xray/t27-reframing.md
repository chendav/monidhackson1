# T27 bounded ephemeral authority capacity

Chief ACCEPT after Reviewer scope correction: include
scripts/read-record-authority-audit.mjs and its direct tests in the existing
tests/unit/record-authority-audit.test.ts, which independently pin historical
versions/capacity. Preserve v1-v4 and accept v5 with the new exact cap.
The bounded hypothesis/experiment is accepted; no new provider call.

## Confirmed cause and zero-network experiment

T26 genuine CER produced216records. The complete sealed authority receipt is
269326bytes, only7182bytes over the262144-byte guard. The production code
replaces the whole manifest with an empty unresolved capacity receipt. This
explains all-zero public collections independently of model semantic quality.

Root replayed unchanged genuine v8 responses with one Vite-only constant
substitution to1048576bytes, saved under separate t27-capacity-* output names.
No production source/model response/prompt/semantic gate changed; no paid calls.
Replay PASS14.74s: integrity and draft match true; authority156verified/60discarded;
public16claims/32requirements;49/49critical facts cited;55public citations.
Mandatory gate,50/94,70/30 and highest combined rating are recovered. Deadline,
replacement completeness and conflict gates are not yet accepted. CER's existing
golden function still fails the current deadline check. Do not overstate scope.

## Proposed smallest runtime change

Raise the private ephemeral manifest cap to524288bytes, not unlimited. This gives
headroom above the measured269326bytes without changing claims or verifier rules.
Keep the exact serialized-byte measurement and cap+1 fail-closed behavior.

Independent read-only downstream inspection found only a small redacted audit
JSONB persists; the full manifest/WeakMap is neither public API nor durable data.
However historical auditv1-v4 schemas currently share the cap constant. Freeze
their262144-byte literal/max, add auditv5 for the new524288 cap, and generate v5
for new audits. Preserve all old audit reads. No SQL migration is required.

Bounded paths: src/lib/analysis/record-authority.ts,
src/lib/runs/record-authority-audit.ts, their two unit test files, and directly
affected audit integration/official capacity tests. Root updates fixed release
selection counts after reviewed test names settle. No OpenAI prompt/schema,
materialize, submission semantics, source cleanup or production configuration
change. No new paid run until cached evidence proves the next required behavior.

Accept hypothesis/experiment independently before implementation. Then rerun
the actual cached CER fixture under production code at524288 and perform focused
cap+1/historical audit regressions. Passing these closes only this capacity bug.
