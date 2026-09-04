# RFP X-Ray publication copy drafts

Status: **NOT FOR PUBLICATION**

These English drafts are ready for evidence finalization, not posting. Replace a
`{{BLOCKED_*}}` token only with a value copied from the linked final release
evidence. Never substitute an estimate, a sample value, a local-test result, or
a component probe. The public Edmonton sample is not a live-provider run.

## Machine-detectable publication gate

```yaml
publication_gate:
  status: NOT_FOR_PUBLICATION
  unresolved:
    - id: BLOCKED_FINAL_BIDWORX_STARTER_PRICE
      evidence: final-day official pricing-page capture with timestamp and SHA-256
    - id: BLOCKED_MONID_ENDPOINT_CHAIN
      evidence: current deployment-bound provider-contract receipt
    - id: BLOCKED_MONID_ACTUAL_COST_USD
      evidence: sanitized paid-verifier report reconciled to the Monid wallet delta
    - id: BLOCKED_AUDITED_RUN_COST_USD
      evidence: accepted sanitized paid-verifier report
    - id: BLOCKED_AUDITED_READY_LATENCY
      evidence: accepted sanitized paid-verifier report
    - id: BLOCKED_LIVE_CAMPAIGN_RESULT
      evidence: reviewed repository deterministic regression manifest 10/10 plus one accepted Edmonton live run and one accepted shuffled four-document CER live run
    - id: BLOCKED_APP_CONTROLLED_CLEANUP_RECEIPT
      evidence: end-to-end production deletion receipts and measured timing
    - id: BLOCKED_REVIEWER_VERDICT
      evidence: independent production review with at least twelve citation click-throughs, P0=0, and P1=0
    - id: BLOCKED_FINAL_COMMIT_SHA
      evidence: final reviewed commit bound to the public production deployment
    - id: BLOCKED_FINAL_VIDEO_SHA256
      evidence: checksum of the final native-upload video file
    - id: BLOCKED_FINAL_VIDEO_URL
      evidence: real public video URL
  required_before_status_change:
    - production health is ready and strict production smoke passes
    - every unresolved item above has evidence and is removed from this list
    - no double-braced BLOCKED token remains in publishable copy
    - every platform receives the checksummed video as a native upload
    - final copy receives independent claim review
```

## Shared truth boundary

Use these statements unchanged unless final evidence narrows them further:

- `Document-only. No tender search.`
- RFP X-Ray analyzes a tender pack supplied by the user.
- The comparison is limited to bidworx Starter's single-tender analysis
  workflow, not its broader writing, collaboration, reporting, integration,
  security, or support capabilities.
- RFP X-Ray presents cited mandatory requirements, evaluation rules, amendment
  replacements, conflicts, risks, and grounded Q&A.
- App-controlled deletion and third-party retention are separate claims. Never
  describe upstream provider data as deleted without provider evidence.
- Any latency inserted below is a labelled observation from its named accepted
  live run. One Edmonton and one CER observation do not establish a median,
  P95, provider stability rate, or cleanup reliability rate.

## X

Post copy:

> RFP X-Ray is document-only—no tender search. It compares only with bidworx Starter's single-tender analysis workflow: supplied PDFs → cited requirements, scoring, amendments, risks & Q&A. Audited run: {{BLOCKED_AUDITED_RUN_COST_USD}}. https://rfp-xray.vercel.app #monid

Native video gate: upload the file identified by
`{{BLOCKED_FINAL_VIDEO_SHA256}}` directly to X. Do not publish a link-only post.
Recheck the final post against X's current character limit after resolving the
cost token.

## LinkedIn

Post copy (must remain below 200 words after token replacement):

> RFP X-Ray is document-only. No tender search.
>
> The comparison is limited to bidworx Starter's single-tender analysis workflow—not its broader bid-management platform.
>
> Supply a tender pack and RFP X-Ray organizes cited mandatory requirements, evaluation rules, amendment replacements, conflicts, risks, and grounded Q&A. Its evidence layer binds quotations to a source SHA-256 and physical PDF page. Results stay unavailable until app-controlled source cleanup is confirmed; upstream-provider retention is disclosed separately.
>
> Audited run cost: {{BLOCKED_AUDITED_RUN_COST_USD}}. Measured ready latency: {{BLOCKED_AUDITED_READY_LATENCY}}.
>
> https://rfp-xray.vercel.app
>
> #monid #procurement #govtech

Native video gate: upload the file identified by
`{{BLOCKED_FINAL_VIDEO_SHA256}}` directly to LinkedIn. Do not publish a link-only
post.

## Instagram Reels

Caption:

> Document-only. No tender search.
>
> RFP X-Ray turns a supplied tender pack into cited requirements, evaluation rules, amendment replacements, conflicts, risks, and grounded Q&A. The comparison is limited to bidworx Starter's single-tender analysis workflow—not the rest of its platform.
>
> Audited run cost: {{BLOCKED_AUDITED_RUN_COST_USD}}
>
> Measured ready latency: {{BLOCKED_AUDITED_READY_LATENCY}}
>
> https://rfp-xray.vercel.app
>
> #monid #procurement #rfp #govtech

Native video gate: upload the file identified by
`{{BLOCKED_FINAL_VIDEO_SHA256}}` as a native Reel. Do not substitute a still,
mock recording, or link-only post.

## TikTok

Caption:

> Document-only. No tender search. RFP X-Ray targets only bidworx Starter's single-tender analysis workflow: a supplied tender pack becomes cited requirements, scoring rules, amendment conflicts, risks, and grounded Q&A. Audited run: {{BLOCKED_AUDITED_RUN_COST_USD}}. https://rfp-xray.vercel.app #monid #procurement #rfp

Native video gate: upload the file identified by
`{{BLOCKED_FINAL_VIDEO_SHA256}}` directly to TikTok. Do not publish a link-only
post.

## YouTube

Title:

> RFP X-Ray: cited tender analysis without search | #monid

Description:

> Document-only. No tender search.
>
> RFP X-Ray analyzes a supplied tender pack into cited mandatory requirements, evaluation rules, amendment replacements, conflicts, risks, and grounded Q&A. The comparison is limited to bidworx Starter's single-tender analysis workflow—not its full bid-management platform.
>
> Audited run cost: {{BLOCKED_AUDITED_RUN_COST_USD}}
>
> Measured ready latency: {{BLOCKED_AUDITED_READY_LATENCY}}
>
> Try the product: https://rfp-xray.vercel.app
>
> App-controlled cleanup evidence and third-party retention are reported separately. Full receipt details are included in the contest entry.
>
> #monid #procurement #rfp #govtech

Native video gate: upload the file identified by
`{{BLOCKED_FINAL_VIDEO_SHA256}}` directly to YouTube. Do not publish a link-only
placeholder or a sample/mock run.

## Contest form fields

### What you killed

> We targeted one bounded job in bidworx Starter
> ({{BLOCKED_FINAL_BIDWORX_STARTER_PRICE}}): the single-tender analysis workflow.
> RFP X-Ray accepts a user-supplied tender pack and produces cited mandatory
> requirements, evaluation rules, amendment replacements, conflicts, risks,
> and grounded Q&A. It is document-only with no tender search, and it does not
> claim to replace bidworx's broader writing, collaboration, reporting,
> integration, security, or support capabilities.

### How you used Monid

> RFP X-Ray integrates Monid as its server-side document-normalization step.
> Audited deployment endpoint chain: {{BLOCKED_MONID_ENDPOINT_CHAIN}}. The
> pipeline immediately retrieves the normalized artifact, while its local
> PDF.js index remains authoritative for source SHA-256 and physical-page
> locations. Structured extraction is constrained to reference evidence text
> rather than inventing page numbers; the server verifies quotations and
> attaches page citations. Monid actual cost was
> {{BLOCKED_MONID_ACTUAL_COST_USD}}. Context.dev zero-data retention was not
> enabled for the tested workspace; its response reported a seven-day upstream
> parsed-artifact expiry. RFP X-Ray proves deletion only for copies it controls.

### The receipt

> Target: bidworx Starter at
> {{BLOCKED_FINAL_BIDWORX_STARTER_PRICE}}, verified from the final-day official
> pricing capture. Scope: its single-tender analysis workflow only.
>
> Audited RFP X-Ray run cost: {{BLOCKED_AUDITED_RUN_COST_USD}}. Measured ready
> latency: {{BLOCKED_AUDITED_READY_LATENCY}}. Monid actual cost:
> {{BLOCKED_MONID_ACTUAL_COST_USD}}. Campaign result:
> {{BLOCKED_LIVE_CAMPAIGN_RESULT}}. App-controlled cleanup:
> {{BLOCKED_APP_CONTROLLED_CLEANUP_RECEIPT}}. Independent review:
> {{BLOCKED_REVIEWER_VERDICT}}. Final commit:
> {{BLOCKED_FINAL_COMMIT_SHA}}.
>
> Product: https://rfp-xray.vercel.app
>
> Native demo video: {{BLOCKED_FINAL_VIDEO_URL}}
>
> Video SHA-256: {{BLOCKED_FINAL_VIDEO_SHA256}}

## Publication evidence ledger

Register each real post within 24 hours of publication. `observed_views` is a
timestamped observation, never a forecast or a blank interpreted as zero.

| platform | native_video_attached | URL | published_at | registered_at (within 24h) | observed_views | observed_at | screenshot_sha256 |
|---|---|---|---|---|---|---|---|
| X | — | {{PENDING_AFTER_PUBLICATION_X_URL}} | — | — | — | — | — |
| LinkedIn | — | {{PENDING_AFTER_PUBLICATION_LINKEDIN_URL}} | — | — | — | — | — |
| Instagram Reels | — | {{PENDING_AFTER_PUBLICATION_INSTAGRAM_URL}} | — | — | — | — | — |
| TikTok | — | {{PENDING_AFTER_PUBLICATION_TIKTOK_URL}} | — | — | — | — | — |
| YouTube | — | {{PENDING_AFTER_PUBLICATION_YOUTUBE_URL}} | — | — | — | — | — |

The `PENDING_AFTER_PUBLICATION_*` ledger markers are post-publication evidence
slots, not permission to post. They must be replaced only with the platform's
real canonical URL after its native-video upload succeeds.
