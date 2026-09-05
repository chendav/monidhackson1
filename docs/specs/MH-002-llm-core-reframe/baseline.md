# Pre-refactor baseline

Date: 2026-09-04. Starting HEAD: `bc6c41e93bfc71292fe17ecde5b31a56d37b1aae`.
Destination: `origin`, https://github.com/chendav/monidhackson1.git, branch `main`.

## Preserved work

- Already committed T24/T25 copied-quote and issued-origin citation work.
- Existing uncommitted T27 receipt-size/audit compatibility changes and tests.
- T26/T27 sanitized diagnostic evidence, current context and LLM-only rule.
- CodeGraph initialization metadata and MH-002 task setup.

This is a recovery/reference checkpoint, not a release candidate. T27's final
independent implementation review was interrupted. Its deterministic release
selection fingerprint still needs a future review/update; no pin is changed in
this task. CER deadline, complete table replacement and three-source horizon
conflict remain unaccepted. Current Q&A is lexical retrieval, not LLM Q&A.

## Verification boundary

Index status, candidate-content hygiene, diff checks and remote Git identity are
checked for this task. Prior unit/build results are historical, not rerun here.
No product code was authored for MH-002; no full suite, paid provider call,
deployment, migration or release promotion is performed. A main-branch push
triggers the repository's existing CI; any connected automatic deployment is
not equivalent to product acceptance, and no deployment attestations are refreshed.

The full PDFs, parsed text, model-response caches, environment files and local
CodeGraph database remain local/ignored. Index rebuild instructions are in
`.codegraph/README.md`. The baseline commit SHA is recorded by the following
planning commit and final handoff, avoiding a self-referential commit field.

## Confirmed remote checkpoint and automatic CI

Baseline commit: `6a2d81e34bf7e67abfda33e0eb71e0ad32d8e364`; remote main equality
confirmed with `git ls-remote`. Existing CI run33931253588 completed with failure:
https://github.com/chendav/monidhackson1/actions/runs/33931253588

Lint/typecheck passed. Tests:841 passed,5 failed,12 skipped; build and browser
steps were skipped. All failures are in `tests/unit/deterministic-regression.test.ts`:
one frozen test-selection mismatch and four `.data` realpath ENOENT errors in
the clean Linux checkout. These are observed baseline defects, not repaired or
waived for product release. MH-002 performed no manual full-suite rerun.
