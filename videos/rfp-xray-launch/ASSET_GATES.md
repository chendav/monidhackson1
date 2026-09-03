# Live Asset Gates

The composition must not be rendered or published while any gate below is
open. These are evidence slots, not placeholders that may appear in the final
video.

`npm run evidence:check` is the deterministic pre-build gate. To close an item,
copy a sanitized, non-secret evidence artifact into this project, change its
checkbox to `[x]`, and replace the two child rows with the project-relative file
and its lowercase SHA-256. A checked box without a present, hash-matching file
still fails. Do not close a gate from memory or an estimate.

- [ ] `frame-01-pricing-refresh` — Refresh the official bidworx screenshot on
  the final day and verify that £190/month and typical usage of one tender
  remain visible.
  - Evidence: pending
  - SHA-256: pending
- [ ] `frame-03-package-input` — Capture the real production CER base plus
  three-amendment input flow.
  - Evidence: pending
  - SHA-256: pending
- [ ] `frame-04-progress-cleanup-cost` — Capture real progress, app-controlled
  deletion, and provider cost.
  - Evidence: pending
  - SHA-256: pending
- [ ] `frame-05-evaluation-citations` — Capture mandatory, 50/94, 70/30, and
  the amended deadline with citations.
  - Evidence: pending
  - SHA-256: pending
- [ ] `frame-06-amendment-conflict` — Capture the 37-row replacement and
  2050/2055 three-page conflict.
  - Evidence: pending
  - SHA-256: pending
- [ ] `frame-07-grounded-qa` — Capture one real grounded Q&A interaction.
  - Evidence: pending
  - SHA-256: pending
- [ ] `frame-08-audit-cost` — Capture Audit & Cost and replace both live metric
  tokens from the sanitized verifier report.
  - Evidence: pending
  - SHA-256: pending
- [ ] `frame-09-cost-consistency` — Reuse the same reconciled cost value as
  Frame 8.
  - Evidence: pending
  - SHA-256: pending
- [ ] `processing-time-disclosure` — Disclose the true end-to-end time across
  every edit that removes processing wait time.
  - Evidence: pending
  - SHA-256: pending

Output requirements checked after the evidence gate passes:

- Main export: English, captioned, 1920×1080, under 90 seconds.
- Social export: English, captioned, 1080×1920.
