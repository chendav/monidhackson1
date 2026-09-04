# T24 implementation handoff

## Outcome

Private record citations now use the v7 `{ f, q, s }` contract. `f` remains a
batch-issued fragment enum and `q` is a nonblank, well-formed, maximum-500 UTF-16
exact source quote. The server requires exactly one raw occurrence of `q` in
the issued fragment, computes `start_utf16` and `length_utf16`, and then runs the
unchanged semantic-to-physical resolver and record-authority verification.

No record-citation offset, page, document hash, or chunk ID is accepted from
the model. Record-level `document_sha256` remains required identity data.
Submission-adjudication relation offsets and schemas are unchanged.

## Changed files

- `src/lib/analysis/record-authority.ts`
  - Added the exact, unique raw quote positioner with bounded/well-formed input.
- `src/lib/providers/openai.ts`
  - Migrated the private record citation schema and decoder from `{f,a,n,s}` to
    `{f,q,s}` and renamed the structured format to `rfp_xray_analysis_v7`.
  - Updated the closed-world prompt to require byte-for-byte source quotes and
    forbid model-authored record-citation offsets.
- `tests/unit/openai-adapter.test.ts`
  - Migrated the fake structured transport and added v7 schema, captured
    Edmonton-style failure, missing/changed quote, foreign fragment, whitespace,
    length, and malformed UTF-16 coverage.
- `tests/unit/record-authority.test.ts`
  - Added exact positioning, ambiguity, changed-number, foreign-fragment,
    whitespace, UTF-16 surrogate, and astral-character regressions.
  - Existing swapped 70/30 role and presentation-safety tests remain green.

## Verification

- `pnpm exec vitest run tests/unit/openai-adapter.test.ts tests/unit/record-authority.test.ts`
  - PASS: 2 files, 145 tests.
- `pnpm typecheck`
  - PASS.
- `git diff --check --` for the four implementation/test paths
  - PASS; only the repository's Windows LF-to-CRLF advisory was printed.

No network, provider, deployment, credential, or paid call was made. No full
suite/build/release regression was run. T23 cached artifacts remain unchanged:

- decoded extraction SHA-256 `792ecc6b2cfd86fe3709a6a6147a960ba0ab998eaa0d3983410e43192e9a33d9`
- trace SHA-256 `8e64ba27088cc106e22c837e497924f792461f7307628a687fe42b6808592012`
- result SHA-256 `a92ab3e2f388050215e1a5d278681dc39496f4b9ecac8840c6f43fd79f78f5aa`

## Compatibility and residual risk

- Old v6 `{f,a,n,s}` responses fail the strict v7 schema; there is no stored-data
  migration because the wire is private and responses are not retained.
- A repeated or representation-drifted quote remains unbound. This intentionally
  trades recall for exact provenance and does not authorize fuzzy repair.
- Accepted representation-only delta: a unique nonempty Unicode whitespace run
  may align to another nonempty Unicode whitespace run. Leading/trailing quote
  whitespace, multiple normalized occurrences, raw spans over 500 UTF-16 units,
  and any digit, punctuation, case, Unicode-composition, or zero-width change
  remain fail-closed. The v7 prompt/schema/request are unchanged.
- The focused tests prove the experimentally observed offset defect is removed,
  but do not prove full CER recovery or amendment behavior. Independent review,
  full release gates, and a separately authorized live proof remain required.
