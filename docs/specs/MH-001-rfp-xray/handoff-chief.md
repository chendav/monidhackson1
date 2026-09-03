# Chief Handoff — Turnstile Configured, Recovery Canary Passed, Release Still Fail-Closed

Updated: 2026-09-03.

## Outcome

The credentialed Monid contract spike is complete. RFP X-Ray can send a
five-minute Railway signed source URL through Monid `context.dev /parse`,
capture the returned Markdown, settle the real provider cost, delete its source
object, and confirm absence. The tested path completed cleanup in 8.140 seconds
and cost USD 0.0009. A direct official-URL parse produced byte-identical
Markdown at the same cost.

This is component evidence, not the full production campaign. Production stays
`NOT_READY` until the configured Turnstile values are deployed, live provider
Workflow runs, final citation review, and contest/publication gates pass. The
current deployment already has runtime and Monid/OpenAI receipts; both must be
refreshed after the Turnstile redeployment.

## Release identity

- Reviewed local implementation commit:
  `4089397de8f2cfc3dc4846911bd9767adea178f4` (not deployed).
- Reviewed application commit:
  `fbb48d09bda4f8d671f6b1679c66d3e0400f45db`.
- Deployed release commit:
  `76e0f4e01f93d67eab4da9b98807959b81578396`.
- Production deployment: `dpl_5dMrPWKGMCKxy5hcQUfq57uLmZce` at
  https://rfp-xray-3dpwofwgr-chendavs-projects.vercel.app.
- Public alias: https://rfp-xray.vercel.app.
- GitHub Actions run `33793276409` passed. The public alias passed the four-case
  read-only production smoke.

## Credential and provider state

- The authorized Monid API key is present in `D:\monidhackson\.env.local`,
  matches the authorized clipboard value, and is ignored by Git.
- The same key is active in the Monid local credential store and stored as a
  Vercel Sensitive Secret for production, preview, and development.
- Exact non-secret `context.dev /parse` adapter paths, canonical inspect hash,
  cost unit, and artifact allowlist are stored for all three Vercel targets.
- The raw canonical inspect SHA-256 is
  `551283ef6526c09f276f4c2d82015168e083cdc348063521db1172c683384476`.
- The current exact deployment has both receipts. The runtime payload SHA-256 is
  `5d50e812e28ee43fdc81bd99c8a2a291a737ff3c607ccb2d148cbba97aa14dbf`; the
  provider payload SHA-256 is
  `0c8ede2c44fc3ff8038eea7640573bdef5cbbb0523ae7583e66b5e8f1743fe07`.
  Health reports Monid and OpenAI as `actively_verified`.

Never print, commit, or copy the Key into evidence. Vercel `env pull` masks
Sensitive Secrets and is not a way to recover them locally.

## Retention and citation decision

Context.dev returned `ZDR_NOT_ENABLED` at zero cost when ZDR was requested. A
successful parse reported an upstream artifact expiry seven days after
completion; no provider early-delete API is known. The candidate therefore:

- discloses unavailable ZDR and seven-day upstream retention before submission;
- repeats the disclosure in Audit & Cost and health metadata;
- promises cleanup only for app-controlled copies;
- warns users not to submit confidential material unless the retention is
  acceptable.

The normalized Markdown preserved useful RFP semantics but no trustworthy
physical-page signals. PDF.js remains the only page-number authority. Monid/
OCR facts that cannot bind to the native physical index are withheld.

## Verification

- `pnpm check`: 47 files passed/4 skipped, 465 tests passed/10 skipped.
- Production build: PASS, 9 Workflow steps, 5 workflows, 13 pages.
- Local Playwright: 14 passed/2 explicit live skips.
- Official PDF fixture audit: 3/3.
- Opt-in paid Monid/Railway live integration: 1/1 PASS.
- Current production read-only smoke: 4/4 PASS.
- Neon schema/concurrency and Railway storage/Cron evidence remain valid within
  their recorded receipt windows.

The analysis-dispatch ACK-loss fence is implemented and its focused claim,
start, settlement, replay, maintenance, and concurrency regressions pass. The
prior candidate received final independent `APPROVE` with P0=0, P1=0, and
P2=0. The watchdog-reclaim and provider-free redelivery deltas separately
received `APPROVE` with P0=0 and P1=0. One real Preview canary received a
  literal `SIGKILL` and completed after same-step redelivery; its final verifier
  re-read the existing run with `workflow_start_count=0`. The tracked log
  receipt is deployment/window-bounded rather than exact-run-bound, and the
  combined evidence review is `APPROVE`, P0=0/P1=0. This proves isolated
  platform redelivery, not full application cleanup recovery. The
conservative five-document full reserve is
USD 1.412123 and includes 24 generated function invocations; this is an
estimate, not a provider receipt.

## Architecture boundary

- Vercel: Web, API, and durable Workflow compute.
- Neon: durable application state and budget ledger.
- Railway: private S3-compatible temporary storage plus one short-lived,
  no-domain maintenance Cron; no analysis worker.
- Monid/context.dev: normalization input, not citation truth.
- OpenAI: bounded structured extraction and closed-document Q&A.

Tender search, bid writing, team/CRM workflow, billing, bidder-fit prediction,
and long-term source storage remain out of scope.

## Next gates

1. Redeploy once with the configured production Turnstile values and refresh
   both exact-deployment receipts.
2. Require health 200 and verify real guest mutations.
3. Run the capped ten-run Edmonton benchmark and four-document CER campaign.
4. Complete an independent production review of at least 12 high-risk links.
5. Record the truthful under-90-second video, register, submit, and publish on
   all five required social platforms.

The video scaffold is already prepared at `videos/rfp-xray-launch/`. Its live
evidence markers are deliberate release blockers; do not render around them or
replace them with estimates. Local scaffold commit
`fc054660aab99dbb46128a7d519bf1885f43ad5a` is independently approved P0=0/P1=0;
the gate currently reports 23 unresolved live-evidence findings by design.

Refresh S3/runtime/provider receipts on September 9 and September 10 at 12:00
MDT. Roll back to the last fail-closed build if any release gate regresses.
