reviewer: independent_reviewer
independent: true
verdict: REQUEST_CHANGES
source_verdict: REVISE
revision_round: 3
review_task: legacy_core_field_delta
report_status: completed_and_superseded_by_T4_redesign
recorded_at: 2026-09-03
reviewed_base_commit: d0b937e8e75ae5b2ae52985f1e1a0cfc7f13a0c5
reviewed_application_commit: null

criteria:
  - id: AC-4
    result: fail
    evidence: Conditional, permissive, and deadline-qualified Portal evidence can be dropped before submission-channel collision handling.
  - id: AC-5
    result: fail
    evidence: A deterministic Email anchor can become the summary value while another possible whole-bid channel remains unresolved.
  - id: AC-10
    result: pass
    evidence: The focused official and unit recovery suite passed 46 of 46 tests on the reviewed delta.
  - id: AC-11
    result: fail
    evidence: Independent review has two open P1 findings, so PASS is not available.

failures:
  - id: P1-SUBMISSION-CONDITIONAL-REJECTION
    acceptance: AC-4
    evidence: Conditional rejection after closing still authorizes Portal for timely bids but was classified as a channel prohibition.
  - id: P1-SUBMISSION-AMBIGUITY-COLLECTOR
    acceptance: AC-5
    evidence: The materializer dropped may/can, not-later-than, and conditional alternate-channel evidence before collision resolution.

regressions:
  - focused_official_and_unit_recovery: 46_passed
  - required_next_cases:
      - permissive_portal
      - not_later_than_portal
      - conditional_rejection_portal
      - unconditional_fax_rejection
      - explicit_portal_prohibition

limitations:
  - This report records the exhausted legacy delta loop; it is not a review of T4.
  - T4 is in progress and has not produced its implementation handoff.
  - QA2 must remain pending until that handoff and its checks exist.
  - Production health is ready, but the last controlled Edmonton run was partial.
  - CER, 12-citation review, final video, submission, and publication remain open.

loop_disposition: redesign_or_human
superseded_by_task: T4
next_review:
  task: QA2
  status: pending_waiting_for_T4_handoff
  allowed_verdicts: [PASS, REQUEST_CHANGES, BLOCKED]
  required_passing_condition: P0=0 and P1=0 with criterion-level evidence

current_release_evidence:
  deployed_commit: d0b937e8e75ae5b2ae52985f1e1a0cfc7f13a0c5
  deployment_id: dpl_2jKkhjjxeRGzq5yxgGS5nL3GJzJF
  public_url: https://rfp-xray.vercel.app
  health_http_status: 200
  health_status: ok
  health_mode: live
  last_controlled_edmonton_result: partial
  last_controlled_edmonton_cost_usd: 1.020701
  app_controlled_cleanup: confirmed
  release_verdict: NOT_READY

historical_evidence_sources:
  - handoff-chief.md
  - handoff-backend.md
  - handoff-frontend.md
  - release-evidence/README.md
  - release-evidence/deployment-summary.md
  - release-evidence/monid-contract-spike-2026-09-03.md
  - release-evidence/workflow-recovery-canary-2026-09-03.md
historical_evidence_policy: Preserve original recorded wording in source files; revalidate before promoting any historical fact into current canonical state.
