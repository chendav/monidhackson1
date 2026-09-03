# Chief Handoff — Monid Contract Spike Passed, Release Still Fail-Closed

Updated: 2026-09-03.

## Outcome

The credentialed Monid contract spike is complete. RFP X-Ray can send a
five-minute Railway signed source URL through Monid `context.dev /parse`,
capture the returned Markdown, settle the real provider cost, delete its source
object, and confirm absence. The tested path completed cleanup in 8.140 seconds
and cost USD 0.0009. A direct official-URL parse produced byte-identical
Markdown at the same cost.

This is component evidence, not the full production campaign. Production stays
`NOT_READY` until Turnstile, the deployment-bound Monid/OpenAI receipt, live
Workflow runs, final citation review, and contest/publication gates pass.

## Release identity

- Reviewed/deployed baseline commit:
  `f1b09e3d0b7f3f6570e61b1a0faeb72b2b85d455`.
- Baseline deployment: `dpl_md5xRevqZNJiDYG4Z6mtjWF4JCQd` at
  https://rfp-xray-pgrtupsau-chendavs-projects.vercel.app.
- Public alias: https://rfp-xray.vercel.app.
- Current working tree adds evidence-linked citations, truthful cost
  completeness, adversarial PDF/OCR checks, the live Monid/Railway probe, and
  the account-specific retention disclosure. It is tested but not yet committed
  or deployed.

## Credential and provider state

- The authorized Monid API key is present in `D:\monidhackson\.env.local`,
  matches the authorized clipboard value, and is ignored by Git.
- The same key is active in the Monid local credential store and stored as a
  Vercel Sensitive Secret for production, preview, and development.
- Exact non-secret `context.dev /parse` adapter paths, canonical inspect hash,
  cost unit, and artifact allowlist are stored for all three Vercel targets.
- The raw canonical inspect SHA-256 is
  `551283ef6526c09f276f4c2d82015168e083cdc348063521db1172c683384476`.
- The deployment-bound provider receipt remains open because it must bind the
  next exact deployment and also execute the OpenAI control-plane check with a
  locally usable credential.

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

- `pnpm check`: 44 files passed/4 skipped, 421 tests passed/10 skipped.
- Production build: PASS, 8 Workflow steps, 4 workflows, 13 pages.
- Local Playwright: 14 passed/2 explicit live skips.
- Official PDF fixture audit: 3/3.
- Opt-in paid Monid/Railway live integration: 1/1 PASS.
- Baseline production read-only smoke: 4/4 PASS.
- Neon schema/concurrency and Railway storage/Cron evidence remain valid within
  their recorded receipt windows.

The analysis-dispatch ACK-loss fence is implemented and its focused claim,
start, settlement, replay, maintenance, and concurrency regressions pass. The
current candidate received final independent `APPROVE` with P0=0, P1=0, and
P2=0. The conservative five-document full reserve is
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

1. Commit and push this schema-v9 candidate; wait for CI and the new exact Vercel deployment.
2. Issue that deployment's runtime receipt and repeat public read-only smoke.
3. Make the OpenAI credential locally available without exposing it, then issue
   the exact deployment-bound provider receipt.
4. Configure production Turnstile and verify real guest mutations.
5. Run the capped ten-run Edmonton benchmark and four-document CER campaign.
6. Complete an independent production review of at least 12 high-risk links.
7. Record the truthful under-90-second video, register, submit, and publish on
   all five required social platforms.

Refresh S3/runtime/provider receipts on September 9 and September 10 at 12:00
MDT. Roll back to the last fail-closed build if any release gate regresses.
