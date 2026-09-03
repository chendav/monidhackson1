review_scope: pre_deploy_release_candidate
recorded_at: 2026-09-03
reviewed_implementation_commit: dfc8be9
working_tree_state: documentation_only_before_release_evidence_commit
public_deployment_state: older_sample_build
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
    limitation: implementation review only; no current receipt until a clean committed deployment exists
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
    railway_compute_service: none
    evidence: release-evidence/railway-storage-probe.md

release_configuration:
  vercel_node: 22.x
  vercel_fluid_compute: enabled
  cron_secret_rotated_in_vercel_production_preview_and_github: true
  github_maintenance_enabled: false
  github_maintenance_enablement_reason: wait_for_new_committed_deployment
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
  - Commit the reviewed documentation/evidence and push both local release commits; the public deployment is older.
  - Inspect the resulting production deployment and store a deployment-bound runtime receipt.
  - Enable GitHub maintenance only after the new deployment, then verify a bounded production heartbeat.
  - Obtain the Monid key and exact configuration and store a current provider-contract receipt before any source or paid call.
  - Configure production Turnstile and verify the deployed guest mutation lifecycle.
  - Run the budget-capped Edmonton ten-run benchmark and complete CER package campaign.
  - Verify end-to-end Workflow recovery, cleanup timing, cost, latency, and every required citation.
  - Complete an independent deployed review of at least 12 high-risk citations.
  - Record the final video and complete the contest submission and five social publications.

limitations:
  - No paid Monid or other live provider call has occurred.
  - No runtime or provider-contract receipt currently exists.
  - Chrome and in-app interactive browser control are unavailable.
  - Turnstile is absent.
  - The real Edmonton/CER campaign, video, submission, and social publication have not occurred.
  - Component checks do not prove end-to-end production readiness.
  - The public sample must not be represented as the current release candidate.

next_gate: Push and deploy the reviewed release commits, then create the exact deployment-bound runtime receipt while all live-provider gates remain fail-closed.
