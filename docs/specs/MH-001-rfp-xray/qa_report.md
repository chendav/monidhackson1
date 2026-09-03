review_scope: retention_cost_citation_monid_contract_and_analysis_dispatch_candidate
recorded_at: 2026-09-03
reviewed_baseline_commit: f1b09e3d0b7f3f6570e61b1a0faeb72b2b85d455
candidate_state: working_tree_approved_commit_migration_and_deploy_pending
captured_public_deployment_id: dpl_md5xRevqZNJiDYG4Z6mtjWF4JCQd
captured_public_deployment_url: https://rfp-xray-pgrtupsau-chendavs-projects.vercel.app
public_deployment_state: baseline_fail_closed_build
release_verdict: NOT_READY

local_verification:
  pnpm_check:
    result: pass
    test_files_passed: 44
    test_files_skipped: 4
    tests_passed: 421
    tests_skipped: 10
  production_build:
    result: pass
    workflow_steps: 8
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
  monid_railway_signed_url_live_probe:
    result: pass
    passed: 1
    default_suite_behavior: skipped_without_explicit_paid_opt_in
    source: official_edmonton_sha_fixed_pdf

independent_reviews:
  baseline_release:
    verdict: APPROVE
    p0: 0
    p1: 0
    p2: 0
    limitation: applies_to_f1b09e3_baseline_not_current_working_tree
  runtime_attestation:
    verdict: APPROVE
    p0: 0
    p1: 0
    p2: 0
    limitation: current receipt binds the baseline deployment and must be renewed after candidate deployment
  provider_contract_attestation_implementation:
    verdict: APPROVE
    p0: 0
    p1: 0
    p2: 0
    limitation: exact candidate deployment and OpenAI-bound receipt remain pending
  security_rereview:
    verdict: APPROVE
    p0: 0
    p1: 0
    p2_follow_up: both recommendations implemented and tested
  maintenance_scheduler:
    verdict: APPROVE
    p0: 0
    p1: 0
    p2: 0
    evidence: seven Railway cycles across more than 30 minutes with zero between-run instances
  current_candidate:
    verdict: APPROVE
    prior_verdict: APPROVE_P0_0_P1_0_P2_0
    delta: infrastructure_cost_envelope_analysis_dispatch_ack_loss_fence_and_current_evidence_sync
    p0: 0
    p1: 0
    p2: 0
    evidence: 44_files_421_tests_passed_4_files_10_tests_skipped_build_8_steps_4_workflows_13_pages_playwright_14_passed_2_live_skipped

live_component_evidence:
  neon:
    result: pass
    public_tables: 9
    migration_rows: 9
    schema_version: 9
    schema_marker: rfp-xray-schema-v9
    live_concurrency_tests: 4_passed
    real_cas_loss_tested: true
    candidate_schema_version: 9
    candidate_migration_prepared: true
    candidate_migration_applied_to_production: true
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
    result: pass_seven_consecutive_cycles
    observation_window_minutes: greater_than_30
    public_domains: 0
    between_run_instances: 0
    restart_policy: NEVER
    evidence: release-evidence/railway-maintenance-cron.md
  monid_contract_spike:
    result: pass_with_retention_limitation
    provider: context.dev
    endpoint: /parse
    canonical_inspect_sha256: 551283ef6526c09f276f4c2d82015168e083cdc348063521db1172c683384476
    successful_paid_parses: 2
    charge_each_usd: 0.0009
    failed_zdr_probe_charge_usd: 0
    signed_url_ttl_seconds: 300
    signed_url_cleanup_total_ms: 8140
    output_bytes: 144275
    output_sha256: 6e8260b80df216fc0b3b8c1a87ed9c87ba1603bdcae8b82c57e82ad58b36ec56
    physical_page_boundaries_present: false
    citation_truth: pdfjs_physical_page_index
    zdr_enabled: false
    upstream_artifact_expiry_observed_days: 7
    provider_early_delete_verified: false
    evidence: release-evidence/monid-contract-spike-2026-09-03.md

release_configuration:
  vercel_node: 22.x
  vercel_fluid_compute: enabled
  monid_key_local_env_present_and_git_ignored: true
  monid_key_local_cli_store_active: true
  monid_key_vercel_sensitive_secret_targets: [production, preview, development]
  monid_exact_adapter_configuration_vercel_targets: [production, preview, development]
  production_turnstile_configured: false
  captured_runtime_receipt: dpl_md5xRevqZNJiDYG4Z6mtjWF4JCQd
  receipt_refresh_heartbeat: Sep_9_and_Sep_10_at_12_00_MDT
  generated_function_invocation_envelope: 24
  five_document_full_reserve_usd: 1.412123
  cost_status: estimated_not_provider_receipt

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
  - Commit and push the candidate, inspect its new production deployment, and issue that exact deployment's runtime receipt.
  - Create the deployment-bound provider receipt using Monid inspect plus the OpenAI control-plane check.
  - Configure production Turnstile and verify the deployed guest mutation lifecycle.
  - Run the budget-capped Edmonton ten-run benchmark and complete the four-document CER campaign.
  - Verify end-to-end Workflow recovery, cleanup timing, cost, latency, and every required citation.
  - Complete an independent deployed review of at least 12 high-risk citations.
  - Record the final video and complete registration, contest submission, and five social publications.

limitations:
  - The two paid Monid parses are contract-spike evidence, not the final campaign.
  - No provider receipt binds the candidate deployment and OpenAI control plane.
  - Chrome and in-app interactive browser control are unavailable.
  - Production Turnstile is absent.
  - Context.dev ZDR is unavailable and upstream artifact expiry was observed at seven days.
  - The real Edmonton/CER campaign, video, submission, and social publication have not occurred.
  - Component checks do not prove end-to-end production readiness.
  - The public sample must not be represented as live-provider execution.

next_gate: Commit, deploy, and attest the exact schema-v9 candidate while production remains fail-closed.
