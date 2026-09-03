# Railway maintenance Cron evidence

Captured: 2026-09-03 UTC.

## Scope

The dedicated Railway project `rfp-xray` contains one service named
`maintenance-cron`. It is a short-lived trigger for
`https://rfp-xray.vercel.app/api/internal/maintenance`; it is not an RFP
worker and does not host Web, API, Workflow, OCR, Monid, OpenAI, database, or
object-storage logic.

The unrelated Railway project `ontology-ai-ready` was not modified.

## Bound configuration

| Property | Observed value |
|---|---|
| Service ID | `fcf7df00-b141-4b6f-bb8a-eb14fb19026e` |
| Deployment ID | `ad097e0c-090f-450c-9016-5f127a5fdef3` |
| Image | `curlimages/curl@sha256:58adaa4e8dca9c988bae2aba4ab3434a0bb2da16bbe3f92dec39ec7785166777` |
| Schedule | `4-59/5 * * * *` |
| Restart policy | `NEVER`, zero retries |
| Public domains | zero |
| Between-run instances | zero |
| Request bounds | 5-second connect timeout, 50-second total timeout, one retry |

The start command expands only `MAINTENANCE_URL` and
`MAINTENANCE_SECRET`, sends the latter as a Bearer header, suppresses response
body output, treats non-2xx as failure, and exits after the request. It has no
Monid, OpenAI, Neon, S3, session, or Turnstile credentials.

The shared maintenance secret was generated in memory and rotated into Vercel
production/preview, GitHub Actions, and Railway without printing it or writing
it to the repository. A post-rotation GitHub `workflow_dispatch` run
(`33760198137`) succeeded against the new Vercel deployment. Manual dispatch
is connectivity evidence only and is not counted as scheduled-delivery proof.

## Real scheduled invocations

Railway emitted three distinct `Starting Container` records. The corresponding
durable Neon heartbeat advanced once per five-minute cycle:

| Cycle | Railway container start | Durable completion | Recorded bounded-work duration | Recorded errors/work |
|---|---|---|---:|---|
| 1 | `2026-09-03T13:19:01.252Z` | `2026-09-03T13:19:01.814Z` | 112 ms | all zero |
| 2 | `2026-09-03T13:24:20.823Z` | `2026-09-03T13:24:20.469Z` | 75 ms | all zero |
| 3 | `2026-09-03T13:29:19.988Z` | `2026-09-03T13:29:19.452Z` | 60 ms | all zero |

Railway and Vercel/Neon timestamps come from different clocks; sub-second
ordering is not asserted. The independent five-minute cycles and monotonic
database updates are the evidence. The largest observed completion gap was
about 5 minutes 19 seconds, below the 15-minute fail-closed freshness limit.

After the third cycle, Railway reported the deployment stopped and its latest
instance `EXITED`, with the next cron time advanced to 13:34 UTC.

## Independent review

The independent release Reviewer verified the pinned registry digest, service
scope, variable names without reading their values, no-domain/no-volume
configuration, three Railway starts, three Vercel production HTTP 200 records,
exited instances, continuing next-run schedule, masked GitHub logs, and fresh
production health. Verdict: `APPROVE`, P0=0, P1=0, P2=0. This closes the prior
scheduled-delivery P1.

## Redundancy and release boundary

GitHub Actions retains the offset five-minute maintenance workflow. Its manual
runs succeeded, but no `event=schedule` run appeared during the initial
observation window. GitHub therefore remains a redundant trigger and is not
the sole basis for maintenance freshness. Vercel's daily Hobby Cron remains a
coarse fallback only.

This evidence closes the initial Railway scheduled-delivery component check;
it does not prove Monid, Turnstile, Edmonton/CER live analysis, end-to-end
cleanup, provider retention/deletion, cost, latency, citation review, video,
contest submission, or publication. Production remains `NOT_READY` while
those gates are open.

## Official references

- https://docs.railway.com/cron-jobs
- https://docs.railway.com/deployments/start-command
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
