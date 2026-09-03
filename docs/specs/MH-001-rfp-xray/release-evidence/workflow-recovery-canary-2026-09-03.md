# Workflow Recovery Canary — 2026-09-03

Observed on one isolated Vercel Preview deployment. This evidence proves the
platform can redeliver this provider-free durable step after a process hard
kill. It does not prove the full RFP analysis, paid-provider idempotency, or
application cleanup-recovery path.

## Bound candidate

- Preview deployment: `dpl_8oC8TRNpAwXgiBfvvpyEh3MwTNtK`.
- Deployed Git commit:
  `d5dc60a0331cd41b37f8f9ef7024c528f828b43e`.
- Workflow:
  `workflow//./src/workflows/redelivery-probe//redeliveryProbeWorkflow`.
- Dynamic run and step identifiers are not retained here. The run SHA-256 is
  `e99c78790735d30512bbbf5bf0d3f94f74cd983efb1180ceacb434b94f3ceaf6`.
- The canary imports and calls no Monid, OpenAI, database, or Blob provider.

## What happened

The canary was started exactly once. Its first attempt invokes the single
deployed `process.kill(process.pid, "SIGKILL")` callsite; attempt 2 returns the
exact deployment, project, team, manifest, configuration, Linux platform, and
attempt binding.

The initial verifier exited non-zero because Vercel's event API omitted its
optional per-event attempt fields. No second start or fault was attempted. The
verifier was revised to read the materialized step, to distinguish direct from
derived attempts, and to support an explicit read-only existing-run mode. A
real read then found that `steps.list` rejects a page size of 1000; the shared
page size was reduced to the provider-compatible 100 and independently
approved before replay.

The final read-only replay recorded:

- `verification_mode=verify-existing`;
- `remote_read_only=true` and `workflow_start_count=0`;
- seven lifecycle events;
- exactly two strictly ordered `step_started` events for one correlation step;
- event attempts `[null,null]`, explicitly labeled
  `derived_platform_omitted_event_attempts` rather than directly observed;
- one unique materialized step with `status=completed` and `attempt=2`;
- exact output with `attempt=2` and matching step hash;
- one `step_completed` and one `run_completed`;
- zero `step_retrying`, `step_failed`, `run_failed`, or `run_cancelled` events;
- no third attempt;
- zero Monid, OpenAI, database, or Blob calls.

The ignored local Workflow receipt has SHA-256
`812942ed29e8d58ea47df7ad8413f6fe654b63f017c99b48bcdc0c1a01f58d57`.
It contains unsalted hashes for dynamic identifiers rather than the identifiers
themselves. This is local-receipt pseudonymization, not anonymity.

## Independent SIGKILL corroboration

A bounded historical Vercel log query used the repository-pinned Vercel CLI
59.11.2, the exact Preview deployment, the original run window plus 60 seconds
on each side, `source=serverless`, and the literal query `SIGKILL`. The
reproducible, remote-read-only generator is commit
`4089397de8f2cfc3dc4846911bd9767adea178f4`.

It returned one row containing exactly one literal `SIGKILL` log message. The
deployed source at the bound Git commit contains exactly one matching hard-kill
callsite. The row contains no raw Workflow run ID, so the receipt is explicitly
`deployment_bounded_window_corroboration_only` with
`exact_run_binding=false`. Raw stdout, stderr, request path, message, request
ID, trace ID, and run ID were held only in memory; the receipt stores local
pseudonymizing hashes, null for the absent trace ID, and byte counts. The
ignored local v2 log receipt has SHA-256
`6c2465a15c9732bb459ee65c99dc6c4305cfe8ec33b5038029983221a92f5349`.
The earlier local v1 receipt and its hash are superseded and must not be cited.

## Review and truth boundary

The verifier implementation, read-only mode, missing-attempt derivation,
100-item pagination correction, reproducible log generator, and final combined
receipts each received independent `APPROVE` verdicts with P0=0 and P1=0.

The read-only receipt's `duration_ms` is verification latency, not original
canary runtime. The attempt sequence is derived from ordered events plus
materialized/output state because Vercel omitted the optional event fields. The
literal log receipt corroborates one hard-kill record only within the exact
deployment and bounded time window; it does not directly bind that row to the
run. None of this closes the final production guest flow, full application
recovery, source cleanup timing, Edmonton/CER campaign, or citation-review
gates.
