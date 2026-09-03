# Demo and publication runbook

Status: prepared, not executed. No video, contest submission, or social post may
be marked complete until every linked evidence field below contains a real URL
or receipt.

## Pre-record gate

- Production commit equals the reviewed commit and the public deployment.
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

## Ninety-second recording script

| Time | Picture | Spoken line / on-screen fact |
|---|---|---|
| 0-6s | Current bidworx Starter pricing page, with capture date visible | “bidworx Starter is £190 per month.” |
| 6-12s | RFP X-Ray landing page and `Document-only. No search.` disclosure | “We replace one closed-document analysis job—not tender search or the whole bid platform.” |
| 12-22s | Add the CER base PDF and amendments 001, 002, and 003 in a deliberately shuffled order | “Drop in the tender pack; upload order does not decide amendment order.” |
| 22-35s | Real progress view | “Monid parses the documents. RFP X-Ray records the provider receipt, then proves that its source copies are gone.” Show real elapsed time if the wait is edited. |
| 35-52s | Compliance and evaluation panels | Show the mandatory gate, 50/94 threshold, 70/30 technical-price weighting, highest combined rating, and the current deadline. |
| 52-68s | Amendment/conflict panel | Show Amendment 003 replacing all 37 M3 rows and the 2050/2055 inconsistency, with citations to amendment physical pages 2, 5, and 6. |
| 68-78s | Ask This RFP | Ask one frozen, answerable question; open its source-page citation. |
| 78-87s | Audit & Cost | Show actual Monid cost, model token cost, storage/platform estimates, wallet reconciliation, failed-attempt cost if one genuinely occurred, and cleanup timing. |
| 87-90s | Closing frame | “bidworx Starter: £190/month. RFP X-Ray: $X per audited run. We replaced tender analysis—not the rest.” Replace `$X` only with the measured audited-run value. |

The recording must never simulate progress, cleanup, wallet balance, cost, or a
provider failure. Cuts across wait time must display the real end-to-end
duration.

## Capture ledger

| Evidence | Required artifact | Status |
|---|---|---|
| Competitor price | URL, capture date, screenshot | pending |
| Reviewed product build | Git commit and Vercel deployment URL | pending |
| Monid contract | inspect schema hash, provider/endpoint, cost unit, retention disclosure | pending |
| Live campaign | sanitized verifier report and wallet reconciliation | pending |
| Deletion | application-controlled source deletion receipts and timing | pending |
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

## Rollback rule

If the strict smoke, live campaign, cleanup timing, wallet reconciliation, or
Reviewer gate regresses after deployment, roll back the public alias to the last
known fail-closed build. Do not publish the video or submit while the release
health endpoint is `not_ready`.
