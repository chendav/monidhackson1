# T25 independent review

## Verdict

**PASS** — P0: 0, P1: 0.

The bounded v8 design is otherwise implemented as reviewed. Record citations
contain only `{q,s}`; the decoder searches only the current batch's source
fragments and assigned submission-coverage windows, constrained by the
record's document SHA. Coverage origins bind server-owned candidate/page/range
and text hashes, every matching occurrence must resolve physically, identical
physical spans are deduplicated by the complete physical identity, and more
than one physical span fails closed. Public evidence remains the raw PDF.js
slice. Submission-relation offsets and downstream semantic/materialization
gates are unchanged.

Focused independent checks passed:

- `T25 server-owned issued evidence origins`: 6/6.
- Relevant OpenAI v8 schema/decode cases: 3/3.
- The zero-provider derived replay reports manifest integrity and draft match,
  82 verified / 34 discarded authority records, 19 public claims, 32 public
  requirements, 15 covered pages, and 53/53 critical claims cited. Its
  provenance explicitly records zero provider calls and zero spend and changes
  cached v7 citations only by removing `f`.

## Resolved revision finding

### P1-1 — New sealed binding semantics retained the old alignment version

Revision 1 changes `RECORD_SOURCE_ALIGNMENT_VERSION` to
`issued-origin-pdfjs-selector-utf16-v4`. Both source-fragment and authenticated
coverage-window bindings are generated under that constant, the strict binding
schema requires it, and receipt re-resolution compares the complete regenerated
binding. The focused suite also pins the exact v4 identity and retains rejection
of a mutated legacy/unknown alignment version. Independent revision testing
passed 7/7 selected cases, so the finding is closed.

## Non-blocking observations

- The cached replay proves server-side v8 behavior, not live model compliance,
  Monid ingestion, cleanup, amendments, CER, or production readiness.
- The legacy comment on `selectorsForEvidenceRepresentation` still says the
  provider chooses a fragment/span; it should eventually be corrected, but it
  does not affect runtime authority.
- A focused negative test for a physically valid but unassigned coverage
  candidate would strengthen the existing `ordered_candidate_ids` guard. The
  current implementation already rejects it through `sourceOriginCommitted`,
  so this is not a P1 blocker.
