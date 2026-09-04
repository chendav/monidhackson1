# T19 Operations Handoff

Task ID: MH-001 / T19

## Confirmed facts

- Candidate commit and origin/main are
  `f84e92b2bb6be1de15aa9bb351aa9c742e73f508`; production deployment is
  `dpl_D7vxrruGA11tLACAahAGCyvVGm7s`.
- CER uses the fixed tracked manifest order amendment 003, base, amendment 001,
  amendment 002. The production UI was staged without submission and the
  capture recorded zero mutating requests.
- CER pass evidence contains only deployment/commit, hashed run identity,
  terminal/cleanup/cost/quality counts, golden check names, and grounded Q&A
  result metadata. The raw run ID is retained only in `.data/release-control/`.
- CER failure evidence records bounded codes, hashed run identity when known,
  terminal cleanup/cost fields, and `retry_authorized=false`.
- Edmonton now calls `materializeRunCaseInput` before run creation, uses the
  saved hash-verified PDF, and refuses to continue unless CORS and signed PUT
  replay-rejection gates pass. Its pass/fail evidence records those gates.
- Both helpers use one generated idempotency key for one durable run. The
  shared create helper may repeat the identical request/key only to recover a
  lost response; it cannot create another admitted run for that execution.
- `node --check` and exact-candidate dry runs pass for both helpers. No provider
  or production mutation occurred during this handoff.

## Inferences

- The scripts are prepared for the post-reset evidence sequence, but no dry run
  proves provider completion, cleanup, result quality, Q&A, or UI citations.

## Unknowns and open gates

- Final-candidate CER live outcome.
- At least 12 authenticated UI citation disclosures on the accepted CER result.
- Final-candidate Edmonton signed-PUT live outcome.
- Independent QA17 verdict.

## Reviewer acceptance checks

- Read-only inspection only; do not execute network-capable helpers.
- Confirm exact commit/deployment and manifest-order assertions.
- Confirm one-run/no-rerun semantics and distinguish identical-key response
  recovery from a second paid campaign.
- Confirm Edmonton materially uses signed PUT rather than its original URL body.
- Confirm cleanup/READY and citation/golden/Q&A gates fail closed.
- Confirm stdout, stderr, and durable evidence do not disclose raw run IDs,
  source text, evidence quotes, signed URLs, credentials, or provider bodies.

## Revision 1 handoff

- Added ignored `release-operator-safety.mjs` as the single validator for
  canonical UUIDs, bounded codes/statuses/stages, create-response run-ID
  consistency, candidate bindings, atomic per-candidate attempt locks, and CER
  pass/review prerequisites.
- Before any paid action, each helper now runs read-only Vercel CLI inspection
  for both the deployment ID and public alias, and requires local `HEAD`,
  `origin/main`, deployment ID, immutable deployment URL, production READY
  state, and configured Git SHA to agree. It also reads the two current
  deployment-bound runtime/provider attestation rows and requires their
  deployment URL, Git SHA, and expiry to match. Revision 1 still used the public
  alias after this proof; that interim routing is superseded by Revision 2
  below because it retained a TOCTOU window.
- Create recovery must yield exactly one canonical UUID across every observed
  response. Possible IDs from a failed recovery are retained only as hashes.
- CER writes a sanitized canonical pass receipt. Citation review requires that
  receipt, closes each disclosure before screenshots, and writes a bound review
  receipt. Edmonton requires both receipts before acquiring its lock or
  uploading the PDF.
- Each paid campaign acquires a candidate/package-specific `wx` lock before its
  first mutation. A second invocation fails with
  `CAMPAIGN_ALREADY_ATTEMPTED`; locks are not removed on failure.
- Local safety counterexamples passed 12/12. Syntax checks passed for the shared
  validator and all three helpers. Exact-candidate read-only Vercel inspection
  passed for the currently deployed candidate. Both dry runs still exit before
  network mutation.

## Revision 2 handoff

- Vercel CLI can mint an automatic protection-bypass cookie for a specified
  immutable deployment. The helper reads it from a mode-restricted temporary
  cookie jar, validates its domain/expiry/value shape, keeps it only in memory,
  zeroes the file buffer, and recursively removes only its `mkdtemp` directory.
- The cookie was used in a read-only proof to access the protected exact
  deployment health endpoint (HTTP 200) and to load the exact deployment in
  Playwright with the expected title and landing heading. No cookie value was
  printed or retained.
- CER and Edmonton now send health, run creation, polling, analysis, and Q&A to
  the immutable deployment URL. `createRunWithRecovery` accepts the in-memory
  cookie as an additional header while keeping authorization, content type, and
  idempotency key non-overridable; its focused test passed 23 with one designed
  skip.
- Edmonton obtains its presign response from the immutable deployment, then
  sends the signed object PUT directly to Railway with the public production
  Origin solely for the CORS proof.
- Citation review injects the same exact-deployment cookie into Playwright and
  opens the immutable deployment URL. The public alias is no longer used for
  page or result requests.
