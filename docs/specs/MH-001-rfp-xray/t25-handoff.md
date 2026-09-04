# T25 backend implementation handoff

## Delivered

- Private extraction record citations are v8 `{q,s}`. The model no longer
  chooses a source fragment or authors record-citation offsets/page metadata.
- Each extraction batch now has an ephemeral issued-evidence registry containing
  exactly its serialized source fragments and its serialized submission
  coverage windows.
- Coverage origins have typed deterministic IDs and bind candidate ID, document
  SHA, physical page, page hash, raw window start/end, and window-text hash.
- Quote resolution is constrained by the record document SHA, enumerates every
  strict whitespace-run-equivalent occurrence, resolves every occurrence to
  PDF.js, deduplicates only identical physical spans, and accepts exactly one.
- Coverage windows resolve directly through their authenticated page-relative
  coordinates. Monid fragments retain the existing semantic-span resolver.
- Authority re-resolution accepts a coverage origin only when its complete
  metadata still matches a candidate committed by that batch. Source-fragment
  origins retain the ordered-fragment commitment.
- Physical bindings are sealed under the new descriptive alignment contract
  `issued-origin-pdfjs-selector-utf16-v4`; receipts carrying the prior v3 value
  fail schema/integrity validation.
- Public evidence remains the exact PDF.js slice. Existing semantic,
  submission-adjudication, authority, receipt, and materialization gates are
  unchanged.

## Changed paths

- `src/lib/providers/openai.ts`
- `src/lib/analysis/record-authority.ts`
- `tests/unit/openai-adapter.test.ts`
- `tests/unit/record-authority.test.ts`
- `docs/specs/MH-001-rfp-xray/t25-handoff.md`

T24 changes already present in these files were preserved.

## Compatibility and cache replay

- The serialized extraction payloads are unchanged.
- Submission candidate assignment, `batch_binding.b`, `batch_binding.l`, and
  the submission relation `{a,n,...}` contract are unchanged.
- The provider instructions and structured response schema deliberately change
  from v7 to v8. A cached v7 response can therefore be replayed only through
  the approved structural conversion that removes citation `f`; its request
  input SHA can still locate the original batch, and no source or classification
  data needs rebuilding.
- No database or persisted-result migration is required because record selectors
  and source registries are private ephemeral analysis data.

## Verification

- `pnpm exec vitest run tests/unit/openai-adapter.test.ts tests/unit/record-authority.test.ts`
  - Revision 1 passed 2 files / 152 tests.
- `pnpm typecheck`
  - passed.
- No network, provider, paid, deployment, full-suite, or commit action occurred.

Focused cases cover wrong legacy fragment selection, a quote available only in
the current coverage window, overlapping representations of one physical span,
distinct physical ambiguity, hidden/foreign document text, altered coverage
metadata, quote mutation, v8 schema strictness, and typed coverage-origin
commitment.

## Residual risk and next gate

- An occurrence present in issued text but not physically resolvable causes the
  citation to fail closed, even if another representation resolves.
- Identical text at distinct physical positions remains ambiguous.
- This implementation does not itself prove record-level Edmonton recovery.
  Root's derived cached v7-to-v8 replay must exercise the real authority and
  materialization path, followed by independent Reviewer verdict.
