# Neon schema and concurrency probe

Current resource verified: 2026-09-03 MDT (`UTC-06:00`).

The live probes used only schema metadata and randomly namespaced control rows;
no tender text or credential was written into this evidence.

## Current schema

| Invariant | Result |
|---|---|
| Migration ledger rows | 8 |
| Public application tables | 9 |
| Required schema version | 8 |
| Schema marker | `rfp-xray-schema-v8` |
| Idempotent migration rerun | PASS |

The added durable state includes maintenance heartbeat and generic release
attestations. Production readiness verifies the exact schema marker and fails
closed on missing, unreachable, fallback, or mismatched state.

## Live concurrency checks

| Suite | Result |
|---|---|
| Application admission/lease/budget contention | PASS |
| Real release-attestation compare-and-swap loss | PASS |
| Total | 2/2 passed |

The second check exercises a real loser in a concurrent compare-and-swap, not a
mocked or inferred conflict.

## Credential chronology

Two earlier database credentials were exposed in local diagnostic output during
setup. Work stopped each time, the affected credential/resource was revoked,
and the current clean resource was provisioned and migrated. No credential
value is present in the repository or this evidence packet.

## Evidence boundary

This proves the current schema-v8 shape and the stated application-level live
concurrency/CAS behavior. It does not prove the new Vercel build is deployed,
that a runtime/provider attestation receipt exists, or that maintenance,
Workflow recovery, paid providers, source cleanup, cost, latency, or citations
work end to end. The release remains `NOT_READY`.
