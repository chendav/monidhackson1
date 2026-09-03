# Demo and publication runbook

Status: prepared, not executed. No video, contest submission, or social post may
be marked complete until every linked evidence field below contains a real URL
or receipt.

Official requirements captured on 2026-09-03 are recorded in
`release-evidence/competition-rules-2026-09-03.md`. Revalidate the official
competition page, guide, and registration form before each external action.

## Registration gate

- Registration closes September 9, 2026.
- Registration requires the entrant-selected team name, Member 1 name/email,
  and exact Monid account email. Never infer these identity fields from Git.
- The organizer attaches the competition key and credits to the registered
  Monid account. A key existing in the web account is not sufficient evidence
  that the local CLI or production deployment can use it.
- Registration confirmation is required before final publication work, but
  registration does not establish product readiness.

## Pre-record gate

- Production commit equals the reviewed commit and the public deployment.
- Competition registration is confirmed and its key is active in the release
  environment without appearing in logs or evidence files.
- Strict production smoke passes with live readiness required.
- The credentialed Monid contract record and provider-retention disclosure are
  frozen.
- Ten Edmonton runs and the four-document CER run pass the paid verifier.
- The CER result contains the three independently reverified citations for the
  2050/2055 conflict.
- Source cleanup, wallet delta, provider actual cost, model cost, total latency,
  and retry evidence are real and internally reconciled.
- An independent Reviewer has clicked at least 12 high-risk citations and has
  returned `APPROVE` with P0=0 and P1=0.

## Under-90-second recording script

The truthful video scaffold lives in `videos/rfp-xray-launch/`. Its
`STORYBOARD.md`, `SCRIPT.md`, and `ASSET_GATES.md` are preparatory artifacts,
not release evidence. The video project's evidence gate must fail while any
`PENDING_LIVE` marker or `{{LIVE_*}}` token remains; only production campaign
captures and reconciled measurements may clear those markers.

| Time | Picture | Spoken line / on-screen fact |
|---|---|---|
| 0-5s | Current bidworx Starter pricing page, with capture date visible | “I replaced the single-tender analysis workflow inside a £190-per-month bid tool.” |
| 5-11s | RFP X-Ray landing page and `Document-only. No search.` disclosure | “This replaces closed-document analysis—not tender search or the whole bid platform.” |
| 11-21s | Add the CER base PDF and amendments 001, 002, and 003 in a deliberately shuffled order | “Drop in the tender pack; upload order does not decide amendment order.” |
| 21-34s | Real progress view | “Monid parses the documents. RFP X-Ray records the provider receipt, then proves that its app-controlled source copies are gone.” Show real elapsed time if the wait is edited. |
| 34-51s | Compliance and evaluation panels | Show the mandatory gate, 50/94 threshold, 70/30 technical-price weighting, highest combined rating, and the current deadline. |
| 51-67s | Amendment/conflict panel | Show Amendment 003 replacing all 37 M3 rows and the 2050/2055 inconsistency, with citations to amendment physical pages 2, 5, and 6. |
| 67-77s | Ask This RFP | Ask one frozen, answerable question; open its source-page citation. |
| 77-86s | Audit & Cost | Show actual Monid cost, model token cost, storage/platform estimates, wallet reconciliation, failed-attempt cost if one genuinely occurred, and cleanup timing. |
| 86-89s | Closing frame | “bidworx Starter: £190/month. RFP X-Ray: $X per audited run. We replaced tender analysis—not the rest.” Replace `$X` only with the measured audited-run value. |

The recording must never simulate progress, cleanup, wallet balance, cost, or a
provider failure. Cuts across wait time must display the real end-to-end
duration. The final master must be shorter than 90 seconds, captioned, and at
least 1080p. Produce a separate captioned 9:16 export for Instagram and TikTok.

## Capture ledger

| Evidence | Required artifact | Status |
|---|---|---|
| Registration | confirmation tied to the entrant-selected team and exact Monid account email | pending; closes Sep 9 |
| Competitor price | URL, capture date, screenshot | captured; refresh on final day |
| Reviewed product build | Git commit and Vercel deployment URL | captured for `76e0f4e` / `dpl_5dMrPWKGMCKxy5hcQUfq57uLmZce`; refresh after Turnstile redeployment |
| Monid contract | inspect schema hash, provider/endpoint, cost unit, retention disclosure | credentialed component spike and exact-deployment Monid/OpenAI receipt captured; refresh after redeployment or expiry |
| Live campaign | sanitized verifier report and wallet reconciliation | pending |
| Deletion | application-controlled source deletion receipts and timing | signed-URL component probe captured at 8.140 s; end-to-end production receipt pending |
| Reviewer | signed verdict and 12-citation click ledger | pending |
| Video | final public video URL and local checksum | pending |
| Contest | submission confirmation URL/receipt | pending |
| X | post URL and observed views | pending |
| LinkedIn | post URL and observed views | pending |
| Instagram | post URL and observed views | pending |
| TikTok | post URL and observed views | pending |
| YouTube | post URL and observed views | pending |

## Publication copy source

Use the same bounded claim everywhere:

> RFP X-Ray turns a supplied tender pack into cited mandatory requirements,
> evaluation rules, amendment replacements, conflicts, risks, and grounded Q&A.
> It does not search for tenders or replace a full bid-management platform.

Add measured cost and latency only after the audited campaign. Do not describe
third-party retention as deletion. Each platform post must link to the public
product and the demo, and its final URL must be copied into the capture ledger.
Upload video natively, include `#monid` in every platform post, and register
each published URL with the organizer within 24 hours. At least one registered
post is required for a valid submission.

## Rollback rule

If the strict smoke, live campaign, cleanup timing, wallet reconciliation, or
Reviewer gate regresses after deployment, roll back the public alias to the last
known fail-closed build. Do not publish the video or submit while the release
health endpoint is `not_ready`.
