# QA17 Operator Safety Review

Task ID: MH-001 / QA17

Verdict: `REQUEST_CHANGES`

Findings: P0=0, P1=5, P2=1.

## Confirmed

- CER input order is fixed as amendment 003, base, amendment 001,
  amendment 002 and matches the staged capture.
- Edmonton re-reads the saved PDF, verifies size and SHA-256, uses signed PUT,
  checks CORS, and requires replay rejection.
- READY, cleanup, golden, citation, and Q&A checks fail closed.
- Dry-run exits before presign, upload, or run creation.
- Failure receipts set `retry_authorized=false`.
- Static syntax checks passed; QA made no network or provider call.

## P1 findings

1. Helpers record hard-coded deployment/commit evidence but call the mutable
   public alias; alias movement could mislabel evidence.
2. Helpers ignore `obtainedRunIds`, omit canonical create-response validation,
   and therefore do not fail if same-key recovery observes conflicting run IDs.
3. Fresh random keys plus no durable attempt lock permit repeated invocations;
   Edmonton does not mechanically require a successful CER citation-review
   receipt before upload/run creation.
4. Citation-review full-page screenshots persist expanded blockquote evidence
   text even though the JSON correctly stores only quote hashes.
5. Remote error/stage strings are not fully bounded before stdout, stderr, or
   failure evidence persistence.

## P2 finding

- Three helpers use a loose 36-character run-ID expression instead of the
  canonical UUID validator.

## Revision 1 scope

- Bind calls to the immutable deployment URL and keep the public alias only as
  the allowed signed-upload Origin where required.
- Canonically validate create responses and require exactly one observed run ID.
- Add durable per-candidate attempt locks and require a bound successful CER
  citation-review receipt before Edmonton.
- Close citation disclosures before screenshots and persist only quote hashes.
- Allowlist codes/stages/statuses and canonical UUIDs before output/persistence.

## Revision 1 re-review

Verdict: `REQUEST_CHANGES`. Findings: P0=0, P1=1, P2=0.

The first revision closed create-ID consistency, attempt sequencing, screenshot
redaction, bounded output, canonical UUID, and signed-PUT findings. One P1
remained: checking the mutable alias only during preflight left a TOCTOU window
for later API and browser requests.

## Revision 2 scope

- Obtain a temporary Vercel deployment-protection cookie with the authenticated
  CLI for the exact deployment ID, without printing or retaining its value.
- Send every health, paid API, result, Q&A, and Playwright request directly to
  the immutable deployment URL using that in-memory cookie.
- Retain the public alias only as the declared browser Origin for the Railway
  signed-PUT CORS proof; it is not an application API target.

## Revision 2 re-review

Verdict: `PASS`. Findings: P0=0, P1=0, P2=0.

The independent Reviewer confirmed that health, presign, create, poll,
analysis, Q&A, and Playwright navigation all target the immutable deployment
URL. The public alias remains only the Railway signed-PUT CORS Origin plus
read-only origin/deployment verification. The Vercel protection cookie is
validated from a temporary jar, kept only in memory, and removed without
entering logs or evidence. Fixed authorization, content-type, and idempotency
headers cannot be overridden. All prior UUID, recovery-ID, exactly-once,
screenshot-redaction, bounded-output, signed-PUT, and dry-run findings remain
closed. Deployment is allowed.

The review was static and credential-free by design. Exact protected-deployment
and attestation responses must therefore be refreshed after the accepted commit
is deployed; this is a release-evidence gate, not an unresolved code defect.
