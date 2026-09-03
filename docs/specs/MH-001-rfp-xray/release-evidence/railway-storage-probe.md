# Railway private-storage probe

## Current bound attestation

Observed: 2026-09-03 04:11 MDT (`UTC-06:00`).

Scope at capture: the dedicated `rfp-xray` Railway project and its private
S3-compatible Bucket. No compute service existed during this storage probe,
and the unrelated `ontology-ai-ready` project was not modified. A later,
separately reviewed short-lived maintenance Cron is documented in
[railway-maintenance-cron.md](railway-maintenance-cron.md); it does not change
the storage attestation scope.

The checked-in probe generated a target-bound safety attestation after checking
the endpoint, region, bucket, URL style, exact CORS policy, absent versioning
and Object Lock, empty historical versions, replay fencing, and physical
deletion behavior.

| Attestation field | Sanitized value |
|---|---|
| Expires | 2026-09-10 04:11:53 MDT |
| Production CORS origin | `https://rfp-xray.vercel.app` |
| Development CORS origin | `http://localhost:3000` |
| Allowed methods | `GET`, `HEAD`, `PUT` |
| Bucket versioning | absent |
| Object Lock | absent |
| Historical object versions | verified empty |

The exact non-secret attestation fingerprint remains in deployment
configuration; credentials, signed URLs, object keys, ETags, and document
content are intentionally excluded here. Expiry or target mismatch fails
production readiness closed.

## Current live checks

| Contract check | Result |
|---|---|
| Checked-in S3 live suite | PASS, 1/1 |
| Real Chromium PUT/read/fence/replay/delete flow | PASS, 1/1 |
| Chromium Origin header | `https://rfp-xray.vercel.app` |
| Probe-object cleanup | PASS |

The browser probe exercised the Railway CORS/object contract from a local test
page whose browser Origin was explicitly set to the production site origin. It
does not by itself prove that the deployed upload UI or server pipeline invokes
the same contract.

## Expiry and refresh

The storage attestation expires before the contest deadline and must be
regenerated against the same target near release. The S3/runtime/provider
receipt refresh heartbeat is scheduled for Sep 9 and Sep 10 at 12:00 MDT. A
scheduled heartbeat is not proof that a future refresh succeeded.

## Evidence boundary

This closes only the current Railway Bucket component contract while its bound
attestation is valid. It does not prove Monid can fetch a signed object,
end-to-end Workflow hard-kill recovery, source-deletion timing in the deployed
pipeline, provider retention/deletion, production Turnstile, live analysis
latency/cost, or contest completion. The release remains `NOT_READY`.
