# T27 bounded authority-capacity handoff

## Delivered

- Raised the private ephemeral record-authority receipt limit from 262,144 to
  exactly 524,288 UTF-8 bytes.
- Retained the same stable manifest payload measurement, complete-manifest
  digest/integrity validation, no truncation, exact-cap acceptance, and cap+1
  rejection.
- Froze persisted record-authority audit versions 1 through 4 at the historical
  262,144-byte limit.
- Added audit version 5 with the otherwise unchanged v4 sanitized shape and the
  exact 524,288-byte limit. New audit writes use v5; no SQL migration is needed
  for the existing JSONB column.
- Updated the standalone operator reader to preserve v1-v4 and accept v5 under
  the same version-specific limits.

No model prompt/schema, submission relation, materialization, source cleanup,
database schema, or public API behavior changed.

## Changed paths

- `src/lib/analysis/record-authority.ts`
- `src/lib/runs/record-authority-audit.ts`
- `scripts/read-record-authority-audit.mjs`
- `tests/unit/record-authority.test.ts`
- `tests/unit/record-authority-audit.test.ts`
- `tests/integration/record-authority-audit.test.ts`
- `tests/golden/official-fixture-audit.test.ts`
- `docs/specs/MH-001-rfp-xray/t27-handoff.md`

`tests/integration/retention-cleanup.test.ts` was exercised but required no edit.

## Verification

- Focused capacity/audit/retention/official-fixture run with
  `RFP_XRAY_FIXTURE_DIR=D:\monidhackson\.data\official-fixtures`:
  5 files, 108 tests passed.
- Direct unit rerun after the final v1/v2 compatibility assertion:
  2 files, 102 tests passed.
- `pnpm typecheck`: passed.
- Scoped `git diff --check`: passed, aside from existing Windows LF-to-CRLF
  notices.

The direct audit tests now prove v1, v2, v3, and v4 reads; v4 accepts 262,144
and rejects 262,145; v5 accepts the measured 269,326-byte CER receipt under the
new exact 524,288 limit. The runtime boundary test accepts the new cap and
rejects cap+1.

The official CER format-size expectations were also updated to the current v8
`{q,s}` schema measurements found by the optional real-PDF test. This closes a
stale T25 fixture expectation and does not change production behavior.

## Test identity impact

- No new test case name was added and no test count changed.
- One existing record-authority capacity test was renamed from the 262,144-byte
  boundary to the 524,288-byte boundary.
- Existing expected audit version/cap values changed from v4/262,144 to
  v5/524,288 for new writes; historical v4 fixtures were added inside an
  existing test.
- Root must recompute release source hashes/identity because production and test
  files changed, even though selected test counts are unchanged.

## Remaining boundary

Root still owns the zero-provider cached CER replay under unmodified production
code. It must reproduce the measured 269,326-byte receipt, manifest integrity,
draft match, recovered 50/94 and 70/30 evidence, and the known missing deadline
and conflict results. T27 does not authorize fixing those remaining semantic
gaps or claiming CER/production acceptance.
