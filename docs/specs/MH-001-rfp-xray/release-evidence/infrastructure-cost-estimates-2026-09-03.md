# Infrastructure Cost Estimate Contract — 2026-09-03

These entries are conservative, reproducible per-run usage allocations. They
are estimates, not provider invoice receipts. They exclude included plan
credits, subscription minimums, tax, and cross-run monthly rounding. Monid
provider-reported cost remains `actual`; OpenAI remains token-derived
`estimated` until an invoice-grade receipt is available.

## Vercel Fluid Compute and Workflow

Official sources:

- https://vercel.com/docs/functions/usage-and-pricing
- https://vercel.com/docs/workflows/pricing
- https://vercel.com/docs/queues/pricing
- https://vercel.com/docs/pricing/regional-pricing

- Highest published regional rates observed on 2026-09-03: USD 0.221 per active
  CPU hour and USD 0.0183 per provisioned GiB-hour.
- Formula uses 4 GiB and one vCPU for the full provider-enforced duration of
  every code-bounded generated Workflow route attempt. The production build
  attests one shared 300-second route, so both flow handlers and step handlers
  are priced at 300 seconds; a per-source-file `maxDuration` cannot lower that
  generated-route ceiling.
- It also allocates one function invocation for every event in the larger,
  failure-inclusive Workflow envelope at USD 0.60 per million and adds 25%
  contingency.
- This intentionally overstates normal I/O-heavy execution because Vercel does
  not charge active CPU while waiting on external services.
- Workflow pricing observed on 2026-09-03 has three separate SKUs: events at
  USD 0.02/1K, data written at USD 0.50/GB, and data retained at USD
  0.50/GB-month. Workflow also uses Vercel Queues; the allocation uses the
  highest published regional Queue rate, USD 0.96/M operations.
- The event envelope is `1,000 + 0 × document_count`, enforced by the shared
  constants in `src/lib/workflow-cost-policy.ts`. It covers the independently
  calculated six-event analysis lifecycle, six-event standalone cleanup-retry
  lifecycle, and two 16-event package watchdog lifecycles, leaving 956 events
  of explicit orchestration reserve. Upload-grant sweeping and expiry are
  maintenance-owned and do not dispatch per-document Workflows.
- The companion generated-function envelope is 24 attempts for every allowed
  package size: analysis is two flow-handler attempts plus one step; standalone
  cleanup is two flow-handler attempts plus one step; and at most two package
  watchdogs each consume six flow-handler attempts plus three step attempts.
  That is eight step-handler attempts and 16 flow-handler attempts. A package
  watchdog processes up to four registrations sequentially per step, so five
  documents require at most two watchdog Workflows rather than five.
  A database-level claim makes the standalone cleanup-retry lifecycle
  single-dispatch per product run; repeated DELETE requests cannot create an
  unbounded number of those workflows.
- Every event receives a deliberately high 64-KiB data-written allocation. The
  application passes only IDs and small status objects through Workflow; PDF,
  parsed Markdown, and model input are excluded from Workflow state by design.
- Retained data is derived from `RUN_TTL_HOURS` plus Vercel Pro's published
  seven-day post-completion retention. The production default is eight days
  total; the allowed 168-hour TTL is costed as fourteen days instead.
- Queue use is allocated as ten single-chunk operation units per event. This is
  deliberately conservative, but Vercel does not publish the internal mapping
  from a Workflow event to Queue operations. It therefore remains an auditable
  allocation that must be calibrated against live usage receipts, not a
  provider-guaranteed conversion. All Workflow and Queue dimensions receive
  the same 25% contingency.
- The analysis Workflow contains only its processing step. The standalone
  cleanup Workflow contains one cleanup step. Neither step retries implicitly;
  recurring maintenance selects any still-pending cleanup at a bounded
  five-minute cadence and owns cleanup retries and expiry.
- Each package watchdog checks all of its registrations immediately, after 60
  seconds, and after 120 seconds. The last check is beyond Monid's attested
  105-second network deadline; recurring maintenance owns any longer tail.
- The CPU/memory term is a strict code-path allocation: it prices every allowed
  flow- and step-handler attempt at the full 300-second generated-route ceiling,
  despite Fluid Compute normally pausing active-CPU billing during external
  I/O. That is 7,200 allocated compute-seconds for either one or five documents.
  An actual Vercel usage receipt is still required before labeling the estimate
  production-verified because invoice rounding, plan allowances, and provider
  metering remain external facts.

An earlier beta/legacy Vercel schedule quoted USD 2.50 per 100,000 steps and
USD 0.00069 per GB-hour of state. The current live Workflow pricing page uses
the GA event/written/retained model above, so the two mutually exclusive
schedules are not added together. For compatibility review, the legacy
candidate is retained as:

`ceil(1.25 × (step_attempts × 2.50 / 100000 + written_GB × (RUN_TTL_HOURS + 168) × 0.00069) × 1,000,000)`

At the default 24-hour TTL, eight allowed step attempts and 0.065536 written GB
yield USD 0.011103 for either one or five documents, below the GA Workflow
allocation. Live Vercel usage/billing evidence must still confirm which schedule the production
account applies before public cost claims are marked verified.

## Neon Postgres

Official source: https://neon.com/pricing

- Scale-plan rate observed on 2026-09-03: USD 0.222 per CU-hour, USD 0.35 per
  GiB-month of storage, and USD 0.20 per GiB-month of history storage.
- A credentialed, read-only production query at
  `2026-09-03T17:47:45.8181157Z` returned
  `max_worker_processes=13`, `max_connections=112`, and
  `shared_buffers=128MB`; no connection identifier or credential was recorded.
- Neon publishes
  `max_worker_processes = 12 + floor(2 × max_compute_size)`. The observed value
  proves the configured maximum is strictly below 1 CU, so the estimate rounds
  up to a 1-CU ceiling. Production pins
  `NEON_EXPECTED_MAX_WORKER_PROCESSES=13` and probes that provider-controlled
  value before each paid analysis; a mismatch fails closed.
- Formula allocates the live-attested 1-CU ceiling for the five-minute bounded
  analysis window, a five-minute scale-to-zero tail, and one additional minute
  per document.
- It allocates 5 MiB of result/history storage for one day and adds 25%
  contingency.

Capacity-formula source:
https://neon.com/docs/reference/compatibility

## Railway private bucket

Official source: https://docs.railway.com/storage-buckets/billing

- Rate observed on 2026-09-03: USD 0.015 per GiB-month; S3 operations and bucket
  egress are free.
- Formula allocates the maximum 25 MiB per supplied document for the full
  30-minute temporary-retention ceiling and adds 25% contingency.
- Railway's invoice rounds aggregate workspace GB-month usage; that shared
  monthly rounding is excluded from an individual run's marginal allocation.
- The short-lived Railway cron and offset GitHub Actions trigger are shared
  maintenance control-plane services, not document-proportional storage. Their
  subscription minimums and shared invocation overhead are excluded from the
  per-run subtotal and reported separately in deployment evidence; they are not
  presented as zero-cost components of an individual analysis.

Every estimate is emitted as its own `CostEvent` with `actual_micro_usd=null`,
an integer `estimated_micro_usd`, a human-readable formula, the source URL, and
the observation date. The live verifier rejects a run if any active provider is
missing, unpriced, duplicated across priced/unpriced sets, or mislabeled as not
applicable.

Exact frozen totals before Monid/OpenAI:

| Input | Vercel compute | Workflow events | Data written | Data retained | Queue | Neon | Railway | Infrastructure total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 document, no Railway adapter | $0.736251 | $0.025000 | $0.040960 | $0.010923 | $0.012000 | $0.050987 | N/A | $0.876121 |
| 5 documents, Railway bucket | $0.736251 | $0.025000 | $0.040960 | $0.010923 | $0.012000 | $0.069487 | $0.000002 | $0.894623 |

At the five-document public limit, the frozen infrastructure commitment plus
the USD 0.495 OpenAI reserve and five USD 0.0045 Monid reserves is USD
1.412123, below the USD 2 run reservation. Included plan allowances remain
excluded, so these are gross usage-equivalent estimates rather than expected
invoice charges.
