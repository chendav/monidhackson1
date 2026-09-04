# T25 reframing: server-owned citation origin selection

## Chief disposition — ACCEPT after independent experiment review

Root's zero-network prototype using the four saved v7 responses resolved
107/120 citations to one physical occurrence: all41 existing bindings,41 of44
wrong same-batch fragment assignments,25 of26 quotes from that request's issued
coverage windows. Three absent quotes and six ambiguous/invalid spans gained
zero bindings. Every matching origin was required to resolve; different physical
keys and ambiguous origins fail closed. Raw source/model records were unchanged.

Independent `authority_review` recomputed and ACCEPTED these results on
2026-09-04. Chief ACCEPTS bounded T25 implementation, with no further provider
call. Only actual serialized source fragments and assigned coverage windows from
the same request may enter the registry. Coverage identity must bind the server's
candidate ID, document/page/page hash, raw window offsets and text hash; origin
IDs are typed and collision-safe. Search remains constrained by record document
SHA. Deduplication uses document/page/page hash/raw start/end/quote hash. All
non-whitespace code units and downstream safety gates remain unchanged.

An offline v7-to-v8 fixture conversion may delete only citation f, preserving
q/s, all factual fields and all semantic classifications. Label it as a derived
fixture, not evidence of a live v8 model response. Completion still requires the
new bindings to traverse real authority and materialization, with preserved
integrity, measured public-record gain and no unsupported definitive assertions.
No production deployment or complete-product verdict is granted by this review.

## Finding

The cached Edmonton v7 result falsifies the assumption that the model can
reliably select `f`. The model usually copied a valid quote, but selected one of
two independently partitioned views incorrectly:

- 120 raw record citations were inspected.
- 41 resolve under the current model-selected fragment.
- 44 quotes occur in another source fragment in the same batch.
- 26 occur in a source window that was supplied to this batch, although their
  Monid source fragment was assigned to another extraction batch.
- 6 are ambiguous or otherwise span-invalid and 3 do not occur in any supplied
  source fragment.

The resulting component extraction is useful (13 claims, 16 requirements and
the golden source values), while authority discards 84 of 116 records. This is
primarily an origin-selection failure, not evidence that the extracted facts or
quotes are absent. The model sees both `documents[].source_fragments[].text`
and `submission_coverage_units[].source_window`; requiring it to name only a
Monid fragment makes a server partition identifier part of semantic extraction.

Evidence is retained under
`.data/diagnostic-package-edmonton-artifacts/`, especially
`quote-diagnostics.json`, `decoded-extraction.json`,
`materialize-trace.json`, and `materialized-result.json`. No further provider
call is needed to test this reframing.

## Minimal canonical contract

In the next private wire version, a record citation should be `{ q, s }`:

- `q` remains a nonblank, well-formed, at-most-500-UTF-16-unit quote copied
  from text actually supplied in the current batch.
- `s` remains the optional section label.
- The record's existing `document_sha256` constrains the search. The model no
  longer supplies `f`, offsets, a page, a citation hash, or a winning source.

The server constructs an ephemeral issued-evidence registry for each batch from
exactly two sources already serialized into that batch request:

1. that batch's `documents[].source_fragments`; and
2. that batch's assigned `submission_coverage_units[].source_window` values.

It must not include a source fragment from another batch merely because the
server has it, nor any package text that was not visible in this request. A
coverage window is eligible because its bytes, document SHA, physical page,
page hash, and page-relative start are already server-owned and were actually
issued in this request.

For every citation the server searches all eligible origins having the record's
document SHA. Matching uses only the accepted v7 representation rule: each
nonempty Unicode whitespace run may match another nonempty Unicode whitespace
run; every non-whitespace UTF-16 unit remains exact, ordered, and case-sensitive.
There is no NFKC, case folding, digit repair, punctuation deletion, whitespace
deletion, fuzzy match, or model-supplied offset.

Each occurrence is resolved to an existing physical PDF.js binding. Candidate
windows map through their server-owned `source_start_utf16` and page identity;
Monid fragments continue through `resolveSemanticSpan`. Results are deduplicated
by physical identity, not origin identity:

```text
document_sha256 + pdf_page_1based + page_text_sha256
+ evidence_start_utf16 + evidence_end_utf16 + evidence_quote_sha256
```

Overlapping fragments or source windows that resolve to the same physical span
therefore count once. Zero physical results fails closed. Two different
physical results remain ambiguous and fail closed, even when their quote text
is identical. The accepted public `evidence_quote` is still the exact PDF.js
slice. All existing semantic, submission-relevance, coverage, authority,
amendment, cleanup, and materialization gates remain downstream and unchanged.

## Smallest implementation boundary

No pipeline or materialization redesign is required.

- `src/lib/providers/openai.ts`
  - bump only the private extraction record-citation wire/format to v8;
  - remove `f` from record citations and the corresponding prompt duty;
  - build the per-batch issued-evidence registry from the same payload and
    assigned candidates used to construct the request;
  - pass `record.document_sha256`, `q`, and that registry to the decoder.
  - Leave submission-adjudication `{a,n,...}` and its schema unchanged.
- `src/lib/analysis/record-authority.ts`
  - factor the current strict whitespace-run matcher into an occurrence
    enumerator;
  - resolve all eligible issued origins, deduplicate physical bindings, and
    return a binding only when one physical identity survives;
  - retain the current binding hashes, exact page re-resolution, public raw
    quote, receipt integrity, and manifest/draft checks. Bump the source
    alignment version if coverage-window origin metadata changes the sealed
    binding contract.
- `tests/unit/openai-adapter.test.ts`
  - assert the v8 `{q,s}` schema and that only current-batch source fragments
    and coverage windows are eligible.
- `tests/unit/record-authority.test.ts`
  - cover wrong model-era fragment, coverage-window-only quotes, overlapping
    origins resolving to one physical span, two different physical spans,
    foreign SHA, absent quote, representation-negative twins, and raw PDF.js
    evidence preservation.
- `tests/golden/official-fixture-audit.test.ts`
  - replay the saved official inputs after the focused boundary passes; update
    only deliberate schema/count identities through the release process.

A practical representation is to add deterministic synthetic source-map origins
for issued coverage windows. Their identity must bind candidate ID, document
SHA, page, page hash, raw page range, and text hash. They may participate in
server re-resolution but need not be exposed as a choice to the model. If the
existing `ordered_source_fragment_ids` integrity check is retained, replace or
generalize it to an ordered `issued_origin_ids` commitment; never silently admit
package-wide origins during verification.

## Offline falsification before production changes

Replay the unchanged cached v7 `output_parsed` values and ignore `f` only in a
local experimental decoder. Reconstruct each original batch's exact payload and
issued-evidence registry, then resolve every `(record.document_sha256, q)` using
the algorithm above. Feed the recomputed bindings into the real authority and
materialization code; do not fabricate citations or alter record content.

Record, per original citation ordinal:

- eligible origin IDs and why each was eligible in this batch;
- strict representation occurrences;
- resolved physical keys before and after deduplication;
- final zero/unique/ambiguous disposition;
- exact public evidence quote and existing authority/materialization outcome.

Expected bounded outcome from current diagnostics:

- baseline: 41 of 120 citations resolve;
- conservative recoverable cohort: the 44 same-batch wrong-fragment citations
  plus the 26 current-batch coverage-window citations, for a ceiling of 111 of
  120 before physical ambiguity and later authority gates;
- the 3 quotes absent from all eligible issued text must remain unresolved;
- the 6 ambiguous/span-invalid cases receive no assumed gain;
- record-level publication gain is measured, not inferred, because one record
  may have several citations and can still fail coverage or semantic gates.

The hypothesis passes only if the cached replay gains bindings exclusively from
current-batch issued bytes, deduplicates overlapping representations to the same
physical span, keeps different physical occurrences ambiguous, preserves exact
PDF.js quotes and hashes, keeps manifest integrity/matches-draft true, and
restores supported golden records without increasing unsupported definitive
claims. Otherwise this design is rejected without another paid call.

## Residual risks

- Quotes genuinely repeated at different physical locations remain unbound;
  contextual inference is intentionally not introduced here.
- Adding coverage windows to the evidence registry increases bounded local
  search work, but their count and size are already bounded by the submission
  ledger and request budget.
- A source window may overlap several candidates; physical-key deduplication is
  mandatory to prevent false ambiguity and receipt growth.
- Changing the private wire requires a new schema/version and deterministic
  regression identity, but does not require stored-result migration because raw
  provider bodies and private selectors are not production persistence data.
