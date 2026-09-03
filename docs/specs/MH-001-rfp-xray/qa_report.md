review_scope: deployed_fail_closed_release_candidate
recorded_at: 2026-09-03
reviewed_implementation_commit: 936041e8ca1ed626978ee8750ba640ef4975c4d9
working_tree_state: documentation_only_evidence_refresh
captured_public_deployment_id: dpl_EW9Bt6QLnhbMSwhEL5yY3AaJ64GE
captured_public_deployment_url: https://rfp-xray-oyfo3261w-chendavs-projects.vercel.app
public_deployment_state: current_fail_closed_build
release_verdict: NOT_READY

local_verification:
  pnpm_check:
    result: pass
    test_files_passed: 39
    test_files_skipped: 3
    tests_passed: 391
    tests_skipped: 7
  production_build:
    result: pass
    workflow_steps: 10
    workflows: 4
    application_pages: 13
  local_playwright:
    result: pass
    passed: 14
    skipped: 2
    skip_scope: explicit_live_environment_checks
  official_fixture_audit:
    result: pass
    passed: 3
  production_dependency_audit:
    result: pass
    known_vulnerabilities: 0
  full_dependency_audit:
    high: 0
    critical: 0
    low: 1
    moderate: 3
    scope_of_remaining_findings: development_chain
  focused_runtime_provider_attestation_tests:
    result: pass
    passed: 33
    pinned_vercel_cli: 59.11.2

independent_reviews:
  runtime_attestation:
    verdict: APPROVE
    p0: 0
    p1: 0
    p2: 0
    limitation: current receipt is exact-deployment-bound and must be renewed after the evidence-only deployment
  provider_contract_attestation:
    verdict: APPROVE
    p0: 0
    p1: 0
    p2: 0
    limitation: implementation review only; no receipt or provider call because the Monid key and exact configuration are absent
  security_rereview:
    verdict: APPROVE
    p0: 0
    p1: 0
    p2_follow_up: both recommendations implemented and tested after review
  maintenance_scheduler:
    verdict: APPROVE
    p0: 0
    p1: 0
    p2: 0
    evidence: three Railway scheduled cycles independently matched to three Vercel production HTTP 200 invocations; instances exited and health stayed fresh

live_component_evidence:
  neon:
    result: pass
    public_tables: 9
    migration_rows: 8
    schema_version: 8
    schema_marker: rfp-xray-schema-v8
    live_concurrency_tests: 2_passed
    real_cas_loss_tested: true
    evidence: release-evidence/neon-concurrency-probe.md
  railway_private_storage:
    result: pass
    bound_attestation_expires: 2026-09-10T04:11:53-06:00
    s3_live_tests: 1_passed
    chromium_production_origin_tests: 1_passed
    browser_origin: https://rfp-xray.vercel.app
    railway_analysis_compute_service: none
    evidence: release-evidence/railway-storage-probe.md
  railway_maintenance_cron:
    result: pass_three_consecutive_cycles
    public_domains: 0
    between_run_instances: 0
    restart_policy: NEVER
    image_digest: sha256:58adaa4e8dca9c988bae2aba4ab3434a0bb2da16bbe3f92dec39ec7785166777
    completed_at_utc:
      - 2026-09-03T13:19:01.814Z
      - 2026-09-03T13:24:20.469Z
      - 2026-09-03T13:29:19.452Z
    duration_ms: [112, 75, 60]
    evidence: release-evidence/railway-maintenance-cron.md

release_configuration:
  vercel_node: 22.x
  vercel_fluid_compute: enabled
  cron_secret_rotated_in_vercel_production_preview_github_and_railway: true
  github_maintenance_enabled: true
  github_manual_dispatch_after_rotation: success_run_33760198137
  github_schedule_event_observed: false
  railway_cron_scheduled_delivery_observed: true_three_cycles
  captured_runtime_receipt: dpl_EW9Bt6QLnhbMSwhEL5yY3AaJ64GE
  receipt_refresh_heartbeat: Sep_9_and_Sep_10_at_12_00_MDT

price_evidence:
  screenshot: release-evidence/bidworx-pricing-2026-09-03.png
  bytes: 714876
  sha256: 5a4d44ba608131cabb7770a28321d85d5552ba52fb4f86fb0b3520340b4f9b34
  captured_at: 2026-09-03T11:46:40.5885646Z
  official_url: https://bidworx.io/pricing
  supported_claims:
    - Starter is shown at £190/month.
    - Typical usage is shown as one tender.

open_release_gates:
  - Commit this documentation/evidence refresh, inspect its production deployment, and store that exact deployment's runtime receipt.
  - Continue monitoring Railway Cron; do not count GitHub workflow_dispatch as scheduled-delivery evidence.
  - Obtain the Monid key and exact configuration and store a current provider-contract receipt before any source or paid call.
  - Configure production Turnstile and verify the deployed guest mutation lifecycle.
  - Run the budget-capped Edmonton ten-run benchmark and complete CER package campaign.
  - Verify end-to-end Workflow recovery, cleanup timing, cost, latency, and every required citation.
  - Complete an independent deployed review of at least 12 high-risk citations.
  - Record the final video and complete the contest submission and five social publications.

limitations:
  - No paid Monid or other live provider call has occurred.
  - A runtime receipt exists only for the captured deployment; no provider-contract receipt exists.
  - Chrome and in-app interactive browser control are unavailable.
  - Turnstile is absent.
  - The real Edmonton/CER campaign, video, submission, and social publication have not occurred.
  - Component checks do not prove end-to-end production readiness.
  - The public sample is current but must not be represented as a live-provider execution.

next_gate: Deploy this evidence-only commit and renew the exact runtime receipt, then obtain Monid and Turnstile configuration while all live-provider gates remain fail-closed.
