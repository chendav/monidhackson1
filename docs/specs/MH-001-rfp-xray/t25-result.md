# T25 measured local result

Independent implementation review: PASS, P0=0/P1=0, revision1. Alignment
contract is `issued-origin-pdfjs-selector-utf16-v4`.

The actual adapter, authority verifier and materializer ran on a derived cached
fixture. The sole conversion removes citation f from four saved v7 batches;
all factual fields, q/s and classifications remain unchanged. The harness checks
the original input SHA and reconstructs f to assert complete content equality.
Original batches are immutable. No provider calls or new cost were incurred.

| Measured result | T24 baseline | T25 |
|---|---:|---:|
| Authority verified / discarded | 32 /84 | 82 /34 |
| True /false physical receipts | 57 /78 | 122 /13 |
| Public claims | 13 | 19 |
| Public requirements | 16 | 32 |
| Public conflicts | 1 | 1 |
| Existing Edmonton golden rules passed | 7 | 7 |

T25 has53/53 critical facts cited; manifest integrity and draft match are true.
Closing date and submission method remain null, risks zero. These are not live
v8 model, Monid, production cleanup/latency or full-product acceptance results.

Checks: focused152/152; full846 passed with12 explicitly designed skips; lint
has no errors (local diagnostic unused-variable warnings), typecheck and build
PASS. Release selection pins97 authority tests plus55 adapter tests. Reviewer
evidence is `t25-review.md`; ignored data/provenance are under
`.data/diagnostic-t25-replay-artifacts/`.
