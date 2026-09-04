# Tasks

## T1 Shared foundation

```yaml
id: T1
owner_profile: chief
objective: Freeze provider facts, public contracts, fixtures, privacy wording, and ownership boundaries.
depends_on: []
include_paths: [package.json, src/contracts/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: []
edits_allowed: true
acceptance: [AC-1, AC-4, AC-7]
handoff: handoff-chief.md
status: completed
```

## T2 Backend and AI pipeline

```yaml
id: T2
owner_profile: backend
objective: Implement storage, ingestion, parsing, cleanup, extraction, reconciliation, API, and server tests.
depends_on: [T1]
include_paths: [src/app/api/**, src/lib/**, src/db/**, drizzle/**, tests/unit/**, tests/integration/**, tests/golden/**]
exclude_paths: [src/app/page.tsx, src/components/**, src/app/globals.css, tests/e2e/**]
edits_allowed: true
acceptance: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-9]
handoff: handoff-backend.md
status: completed_baseline
```

## T3 Frontend working surface

```yaml
id: T3
owner_profile: frontend
objective: Implement the responsive English upload, progress, analysis, citation, Q&A, and cost experience.
depends_on: [T1]
include_paths: [src/app/page.tsx, src/app/layout.tsx, src/app/globals.css, src/components/**, tests/e2e/**]
exclude_paths: [src/app/api/**, src/lib/**, src/db/**, drizzle/**]
edits_allowed: true
acceptance: [AC-8, AC-10]
handoff: handoff-frontend.md
status: completed_baseline
```

## QA1 Baseline independent review

```yaml
id: QA1
owner_profile: reviewer
objective: Independently verify the baseline implementation against acceptance criteria and regressions.
depends_on: [T2, T3]
include_paths: [src/**, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_historical
```

## REV-1 Baseline release blockers

```yaml
id: REV-1
owner_profile: chief
objective: Coordinate resolution of the baseline independent review findings without broadening product scope.
depends_on: [QA1]
include_paths: [src/**, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: []
edits_allowed: true
acceptance: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11]
handoff: handoff.md
status: completed_historical
```

Historical implementation and review evidence for T1-T3, QA1, and REV-1 remains
in the role-specific handoffs and `release-evidence/`. Those records retain
their original wording and are not current task status.

## T4 Edmonton core-field classifier redesign

```yaml
id: T4
owner_profile: backend
objective: Complete deterministic Edmonton core-field recovery with one shared submission-channel classifier that distinguishes publishable evidence from possible ambiguity.
depends_on: [T2]
include_paths: [src/lib/analysis/source-anchors.ts, src/lib/analysis/materialize.ts, src/lib/analysis/submission-channel.ts, tests/golden/official-fixture-audit.test.ts, tests/unit/closed-template-recovery.test.ts, tests/unit/core-field-recovery-materialize.test.ts]
exclude_paths: [src/app/**, src/components/**, drizzle/**, docs/agent_knowledge/**]
edits_allowed: true
acceptance: [AC-4, AC-5, AC-10]
handoff: handoff-backend.md
status: completed_not_accepted_revision_loop_exhausted
```

## QA2 Edmonton redesign review

```yaml
id: QA2
owner_profile: reviewer
objective: Independently verify T4, official Edmonton facts, submission-channel ambiguity semantics, and affected regressions.
depends_on: [T4]
include_paths: [src/lib/analysis/**, tests/golden/official-fixture-audit.test.ts, tests/unit/closed-template-recovery.test.ts, tests/unit/core-field-recovery-materialize.test.ts]
exclude_paths: []
edits_allowed: false
acceptance: [AC-4, AC-5, AC-10, AC-11]
handoff: qa_report.md
status: completed_request_changes_redesign_required
```

## T5 Submission relation ambiguity redesign

```yaml
id: T5
owner_profile: backend
objective: Replace surface-form completeness assumptions with a conservative unresolved-evidence ambiguity fence so parser uncertainty cannot prove a different submission channel unique.
depends_on: [QA2]
include_paths: [src/lib/analysis/submission-channel.ts, src/lib/analysis/source-anchors.ts, src/lib/analysis/materialize.ts, tests/unit/closed-template-recovery.test.ts, tests/unit/core-field-recovery-materialize.test.ts, tests/unit/summary-recovery.test.ts, tests/unit/materialize-reconciliation.test.ts]
exclude_paths: [src/app/**, src/components/**, drizzle/**, docs/agent_knowledge/**]
edits_allowed: true
acceptance: [AC-4, AC-5, AC-10]
handoff: handoff-backend.md
status: completed_not_accepted_architectural_failure
```

## QA3 Submission relation redesign review

```yaml
id: QA3
owner_profile: reviewer
objective: Independently verify T5 publication, possibility, prohibition, and unresolved-evidence semantics plus all Edmonton regressions.
depends_on: [T5]
include_paths: [src/lib/analysis/**, tests/golden/official-fixture-audit.test.ts, tests/unit/closed-template-recovery.test.ts, tests/unit/core-field-recovery-materialize.test.ts, tests/unit/summary-recovery.test.ts, tests/unit/materialize-reconciliation.test.ts]
exclude_paths: []
edits_allowed: false
acceptance: [AC-4, AC-5, AC-10, AC-11]
handoff: qa_report.md
status: completed_request_changes
```

## T6 Agent-semantic submission adjudication

```yaml
id: T6
owner_profile: backend
objective: Replace deterministic English relation parsing with Agent adjudication over a complete high-recall source candidate ledger while keeping citation, coverage, conflict, and publication gates deterministic.
depends_on: [QA3]
include_paths: [src/lib/analysis/**, src/lib/providers/**, src/lib/evidence/**, src/lib/pipeline.ts, tests/unit/**, tests/integration/**, tests/golden/**]
exclude_paths: [src/app/page.tsx, src/components/**, src/app/globals.css, drizzle/**, docs/agent_knowledge/**]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_not_accepted_review_exhausted
```

## QA4 Agent-semantic review

```yaml
id: QA4
owner_profile: reviewer
objective: Independently verify candidate completeness, Agent adjudication, deterministic quote/page coverage, disagreement handling, cost bounds, and final publication safety.
depends_on: [T6]
include_paths: [src/lib/analysis/**, src/lib/providers/**, src/lib/evidence/**, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_request_changes_exhausted
```

## T7 Record-bound Agent semantic authority

```yaml
id: T7
owner_profile: backend
objective: Bind every model-authored public evidence record to an inline Agent submission-relevance decision and verified private relations so Draft output cannot bypass submission authority through an arbitrary collection or vocabulary.
depends_on: [QA4]
include_paths: [src/lib/analysis/**, src/lib/providers/**, src/lib/evidence/**, src/lib/pipeline.ts, tests/unit/**, tests/integration/**, tests/golden/**]
exclude_paths: [src/app/page.tsx, src/components/**, src/app/globals.css, drizzle/**, docs/agent_knowledge/**]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
```

## QA5 Record-bound authority review

```yaml
id: QA5
owner_profile: reviewer
objective: Independently verify one-to-one semantic annotation for every model record, relation/citation binding, collection-independent veto, and all prior T6 regressions.
depends_on: [T7]
include_paths: [src/lib/analysis/**, src/lib/providers/**, src/lib/evidence/**, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_approve
```

## T19 Final production evidence operators

```yaml
id: T19
owner_profile: operations
objective: Bind the final candidate to one shuffled CER run, authenticated citation review, and one Edmonton signed-PUT run while preventing evidence leakage, cap expansion, or automatic paid reruns.
depends_on: [QA16]
include_paths: [.data/single-cer-production.mjs, .data/single-edmonton-production.mjs, .data/review-retained-run.mjs, .data/demo-captures/**, docs/agent_context/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/**, tests/**, drizzle/**, videos/**]
edits_allowed: true
acceptance: [AC-3, AC-4, AC-5, AC-6, AC-9, AC-10]
handoff: handoff-operations.md
status: completed_accepted
constraints: [no_paid_calls_before_budget_reset, exact_candidate_binding, one_CER_run, one_Edmonton_run_after_CER_review, no_automatic_paid_rerun, raw_run_ids_ignored_local_only, sanitized_public_evidence]
```

## QA17 T19 operator safety review

```yaml
id: QA17
owner_profile: reviewer
objective: Independently verify exact candidate/input binding, one-run semantics, same-key response recovery, Edmonton signed-PUT materialization, cleanup gates, failure evidence, and redaction boundaries without network or provider calls.
depends_on: [T19]
include_paths: [.data/release-operator-safety.mjs, .data/release-operator-safety.selftest.mjs, .data/single-cer-production.mjs, .data/single-edmonton-production.mjs, .data/review-retained-run.mjs, .data/demo-captures/*.json, scripts/live-verify.mjs, docs/agent_context/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/**, tests/**, drizzle/**, videos/**]
edits_allowed: false
acceptance: [AC-3, AC-4, AC-5, AC-6, AC-9, AC-10, AC-11]
handoff: qa17-report.md
status: completed_pass
revision_round: 2
revision_scope: [P1_MUTABLE_ALIAS_TOCTOU]
forbidden_actions: [network_calls, provider_calls, production_mutations, paid_runs, file_edits]
verdict: PASS
p0: 0
p1: 0
p2: 0
deployment_allowed: true
```

## T9 Source-ledger package authority

```yaml
id: T9
owner_profile: backend
objective: Make the complete all-page source ledger own package submission safety while record authority gates only publication and exact-source ledger disagreements.
depends_on: [QA6]
include_paths: [src/lib/analysis/record-authority.ts, src/lib/analysis/materialize.ts, src/lib/runs/record-authority-audit.ts, scripts/read-record-authority-audit.mjs, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/app/**, src/components/**, drizzle/**]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
```

## QA7 T9 source-ledger authority review

```yaml
id: QA7
owner_profile: reviewer
objective: Independently verify all-page ledger ownership, invented-record DoS resistance, exact-source gap vetoes, receipt v3 compatibility, and diagnostic redaction.
depends_on: [T9]
include_paths: [src/lib/analysis/**, src/lib/runs/record-authority-audit.ts, scripts/read-record-authority-audit.mjs, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_approve
```

## T10 Batch-bound semantic delivery contract

```yaml
id: T10
owner_profile: backend
objective: Replace lossy sidecar delivery with record-local relevance and batch-bound exact submission coverage, and persist redacted v4 diagnostics that distinguish receipt and adjudication failures without weakening unfamiliar-channel safety.
depends_on: [QA7]
include_paths: [src/lib/providers/openai.ts, src/lib/analysis/record-authority.ts, src/lib/analysis/submission-channel.ts, src/lib/analysis/materialize.ts, src/lib/runs/record-authority-audit.ts, src/lib/pipeline.ts, src/lib/runs/**, src/db/**, drizzle/**, scripts/read-record-authority-audit.mjs, scripts/read-submission-adjudication-audit.mjs, scripts/database-schema-probe.mjs, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/app/page.tsx, src/components/**, src/app/globals.css]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
```

## QA8 T10 semantic delivery review

```yaml
id: QA8
owner_profile: reviewer
objective: Independently falsify exact per-batch coverage, record-local relevance binding, v4 diagnostic redaction and compatibility, unfamiliar-channel handling, and unchanged paid-call and budget bounds.
depends_on: [T10]
include_paths: [src/lib/providers/**, src/lib/analysis/**, src/lib/runs/**, src/lib/pipeline.ts, scripts/read-record-authority-audit.mjs, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_pass
```

## EXT-1 Production evidence and publication

```yaml
id: EXT-1
owner_profile: chief
objective: Verify the accepted build with controlled production runs, citations, cost, latency, video, contest submission, and publication evidence.
depends_on: [QA5]
include_paths: [docs/specs/MH-001-rfp-xray/**, videos/rfp-xray-launch/**]
exclude_paths: [src/**, tests/**, drizzle/**]
edits_allowed: true
acceptance: [AC-3, AC-4, AC-5, AC-6, AC-8, AC-9, AC-10, AC-11]
handoff: handoff.md
status: in_progress
confirmed_partial_evidence:
  - Production health is HTTP 200 and reports the database, storage, Workflow, Monid, and OpenAI gates ready.
  - The last controlled Edmonton run ended partial, cost USD 1.020701, and completed app-controlled cleanup.
open_gates:
  - A new controlled Edmonton run that reaches READY and passes the golden facts.
  - The CER main-plus-three-amendment production campaign.
  - Independent click-through of at least 12 high-risk production citations.
  - Final 90-second video, contest submission, and five required publications.
truth_boundary: Healthy components and a partial run do not establish final product or contest completion.
```

## T11 Provider-private bounded-relation repair

```yaml
id: T11
owner_profile: backend
objective: Make invalid submission spans and low-confidence decisive relations structurally unrepresentable in provider wire v3, distinguish merged relevance disagreement from missing delivery, and prevent model evaluation records from clearing a server-recovered selection method.
depends_on: [QA8]
include_paths: [src/lib/providers/openai.ts, src/lib/analysis/submission-channel.ts, src/lib/analysis/record-authority.ts, src/lib/analysis/materialize.ts, src/lib/runs/record-authority-audit.ts, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/app/page.tsx, src/components/**, src/app/globals.css, drizzle/**]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
```

## QA9 T11 bounded-relation review

```yaml
id: QA9
owner_profile: reviewer
objective: Independently falsify provider wire v3 bounds, explicit uncertainty, descriptive relevance decoding, merged-relevance diagnostics, recovered-selection precedence, unfamiliar-channel safety, and unchanged call/retry/budget limits.
depends_on: [T11]
include_paths: [src/lib/providers/openai.ts, src/lib/analysis/submission-channel.ts, src/lib/analysis/record-authority.ts, src/lib/analysis/materialize.ts, src/lib/runs/record-authority-audit.ts, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_pass
```

## T12 Canonical ownership-core submission ledger

```yaml
id: T12
owner_profile: backend
objective: Separate overlapping source context from non-overlapping semantic authority so every page position and relation has exactly one canonical owner, while preserving unfamiliar-channel and mixed-record fail-closed behavior.
depends_on: [QA9]
include_paths: [src/lib/providers/openai.ts, src/lib/analysis/submission-channel.ts, src/lib/analysis/record-authority.ts, src/lib/analysis/materialize.ts, src/lib/runs/submission-adjudication-audit.ts, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/app/**, src/components/**, drizzle/**]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
revision_round: 1
revision_scope: P1_QA10_HALO_CONTEXT_BECOMES_RECORD_AUTHORITY
```

## QA10 T12 canonical-core review

```yaml
id: QA10
owner_profile: reviewer
objective: Independently falsify complete non-overlapping core ownership, halo context, unique relation ownership, explicit coverage uncertainty, unfamiliar-channel handling, preserved mixed-record vetoes, and unchanged budgets and retries.
depends_on: [T12]
include_paths: [src/lib/providers/openai.ts, src/lib/analysis/submission-channel.ts, src/lib/analysis/record-authority.ts, src/lib/analysis/materialize.ts, src/lib/runs/submission-adjudication-audit.ts, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_pass
```

## T13 Domain-bounded coverage and relation-relative conditions

```yaml
id: T13
owner_profile: backend
objective: Make coverage quantify only exhaustive delivery-relation scanning of each owned core, and replace context-relative condition coordinates with one relation-relative condition object without weakening uncertainty, unfamiliar-channel handling, or record vetoes.
depends_on: [QA10]
include_paths: [src/lib/providers/openai.ts, src/lib/analysis/submission-channel.ts, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/app/**, src/components/**, drizzle/**]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
```

## QA11 T13 contract review

```yaml
id: QA11
owner_profile: reviewer
objective: Independently falsify domain-bounded coverage, complete-empty cores, explicit plausible-relation uncertainty, relation-relative condition bounds, unfamiliar SecureDrop handling, preserved mixed and relation-gap vetoes, and unchanged paid-call and budget limits.
depends_on: [T13]
include_paths: [src/lib/providers/openai.ts, src/lib/analysis/submission-channel.ts, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_pass
```

## T14 Stable Monid semantic contract fingerprint

```yaml
id: T14
owner_profile: backend
objective: Replace the volatile whole-inspect-response hash with a strict canonical fingerprint of only the verified context.dev parse identity, request/response contract, result/cost paths, and price terms, while failing closed on any material contract drift.
depends_on: [QA11]
include_paths: [src/lib/providers/monid.ts, src/lib/health/provider-contracts.ts, scripts/attest-provider-contracts.mjs, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/app/**, src/components/**, src/lib/analysis/**, drizzle/**]
edits_allowed: true
acceptance: [AC-3, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
```

## QA12 T14 provider fingerprint review

```yaml
id: QA12
owner_profile: reviewer
objective: Independently prove telemetry-only Monid inspect drift is ignored while endpoint, schema, cost, currency, paths, limits, and provider identity drift fail before paid dispatch.
depends_on: [T14]
include_paths: [src/lib/providers/monid.ts, src/lib/health/provider-contracts.ts, scripts/attest-provider-contracts.mjs, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-3, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_pass
```

## T15 Demand-aware OpenAI batch output capacity

```yaml
id: T15
owner_profile: backend
objective: Replace the falsified equal-share output-token assumption with the smallest deterministic demand-aware allocation that lets unequal extraction batches use the fixed 50,000-token aggregate without increasing the USD 0.495 OpenAI reserve, retry count, or context limits.
depends_on: [QA12]
include_paths: [src/lib/providers/openai.ts, src/lib/config.ts, tests/unit/openai-adapter.test.ts, tests/golden/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/app/**, src/components/**, drizzle/**, scripts/live-verify.mjs]
edits_allowed: true
acceptance: [AC-2, AC-5, AC-6, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
revision_round: 1
revision_scope: P1_QA13_RESPONSE_INPUT_USAGE_CAN_ESCAPE_OPENAI_RESERVE
constraints: [saved_fixtures_only_before_QA13, no_paid_calls, no_Edmonton_reparse, aggregate_output_tokens_lte_50000, openai_reserve_lte_495000_micro_usd, one_attempt_per_batch]
```

## QA13 T15 output-capacity review

```yaml
id: QA13
owner_profile: reviewer
objective: Independently falsify the demand-aware allocation using skewed, symmetric, minimum-cap, cost, context, incomplete-response, and saved CER plan cases, and confirm no extraction semantics or provider-call count changed.
depends_on: [T15]
include_paths: [src/lib/providers/openai.ts, src/lib/config.ts, tests/unit/openai-adapter.test.ts, tests/golden/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-5, AC-6, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_pass
revision_round: 1
failed_acceptance: [AC-9, AC-11]
```

## T16 Physical-page source binding

```yaml
id: T16
owner_profile: backend
objective: Repair the observed representation mismatch so exact evidence selected from model-visible Monid Markdown is deterministically rebound to one server-owned PDF.js physical-page span, without admitting paraphrase, ambiguous occurrences, wrong-document evidence, or inferred page numbers.
depends_on: [QA13]
include_paths: [src/lib/analysis/record-authority.ts, src/lib/providers/openai.ts, tests/unit/record-authority.test.ts, tests/unit/openai-adapter.test.ts, tests/golden/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/app/**, src/components/**, drizzle/**, scripts/live-verify.mjs]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-6, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
revision_round: 2
revision_scope: [STALE_V1_PIPELINE_AUDIT_FIXTURE]
constraints: [saved_local_PDFs_and_synthetic_pairs_only, no_paid_calls, no_remote_or_Monid_reparse, local_PDFjs_indexing_allowed, exact_PDFjs_quote_required, unique_physical_page_binding, no_paraphrase_acceptance, unchanged_provider_and_cost_limits]
```

## QA14 T16 source-binding review

```yaml
id: QA14
owner_profile: reviewer
objective: Independently falsify the source-binding repair with whitespace, Markdown table, repeated-text, wrong-document, wrong-page, paraphrase, Unicode, page-core ownership, and CER golden cases; require exact returned PDF.js evidence and no weaker citation gate.
depends_on: [T16]
include_paths: [src/lib/analysis/record-authority.ts, src/lib/providers/openai.ts, tests/unit/record-authority.test.ts, tests/unit/openai-adapter.test.ts, tests/golden/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-6, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_pass
revision_round: 2
verdict: PASS
findings: { P0: 0, P1: 0, P2: 0 }
```

## T17 Selector-scoped physical alignment

```yaml
id: T17
owner_profile: backend
objective: Replace the production-falsified whole-fragment prerequisite with authenticated selector-scoped alignment from the exact selected Monid substring to one contiguous PDF.js physical-page slice.
depends_on: [QA14]
include_paths: [src/lib/analysis/record-authority.ts, src/lib/providers/openai.ts, tests/unit/record-authority.test.ts, tests/unit/openai-adapter.test.ts, tests/golden/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/app/**, src/components/**, drizzle/**, scripts/live-verify.mjs]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-6, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
revision_round: 1
revision_scope: [P1_QA15_TARGET_COMPATIBILITY_GLYPH_CAN_BE_PARTIALLY_SELECTED]
constraints: [no_paid_calls, no_remote_or_Monid_reparse, local_PDFjs_indexing_allowed, selector_source_hash_and_coordinates_authenticated, exact_PDFjs_quote_required, unique_single_page_binding, ambiguity_and_paraphrase_fail_closed, unchanged_provider_and_cost_limits]
```

## QA15 T17 selector-alignment review

```yaml
id: QA15
owner_profile: reviewer
objective: Independently falsify selector-scoped alignment against harmless whole-fragment drift, repeated selections, surrounding-context disambiguation, tables, Unicode, wrong document, wrong fragment, coordinate mutation, cross-page spans, deleted negation, paraphrase, and all prior QA14 counterexamples.
depends_on: [T17]
include_paths: [src/lib/analysis/record-authority.ts, src/lib/providers/openai.ts, tests/unit/record-authority.test.ts, tests/unit/openai-adapter.test.ts, tests/golden/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-6, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_pass
revision_round: 1
verdict: PASS
findings: { P0: 0, P1: 0, P2: 0 }
```

## T18 Split deterministic regression from live release proof

```yaml
id: T18
owner_profile: backend
objective: Replace the obsolete eleven-paid-run release gate with a reviewed repository deterministic regression manifest at 10/10, live Edmonton 1/1, and shuffled live CER 1/1 evidence, without claiming provider-shaped execution, while preserving the former campaign as an opt-in benchmark and retaining every live-only safety gate.
depends_on: [QA15]
include_paths: [scripts/live-verify.mjs, scripts/deterministic-regression.mjs, tests/unit/live-verify.test.ts, tests/unit/deterministic-regression.test.ts, vitest.config.ts, package.json, pnpm-lock.yaml, tests/golden/**, tests/integration/**, tests/unit/**, docs/specs/MH-001-rfp-xray/**, docs/agent_context/**]
exclude_paths: [src/**, drizzle/**, videos/**]
edits_allowed: true
acceptance: [AC-3, AC-4, AC-5, AC-6, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_handoff_revision_3
revision_round: 3
revision_scope: [FULL_GATE_EXTERNAL_FIXTURE_ENV_ABSENCE_MUST_SKIP_OUTSIDE_RUNNER]
constraints: [no_network, no_provider_calls, no_paid_work, repository_runner_executes_ten_named_non_skipped_tests, structured_test_identity_count_and_status_required, saved_official_PDF_hashes_required, runner_manifest_config_dependency_and_test_sources_hash_bound_to_candidate_commit, no_provider_shaped_execution_or_intermediate_artifact_claim, no_externally_self_signed_pass_json, old_eleven_run_mode_remains_opt_in, no_p95_or_stability_claim_from_single_runs, regression_cannot_satisfy_live_cleanup_ingress_provider_cost_or_review]
```

## QA16 T18 release-evidence review

```yaml
id: QA16
owner_profile: reviewer
objective: Independently falsify evidence-class separation, exact non-skipped deterministic-regression summaries, source/config/dependency binding, benchmark opt-in behavior, live-only cleanup/cost/citation gates, and removal of unsupported provider-shaped, percentile, or stability claims.
depends_on: [T18]
include_paths: [scripts/live-verify.mjs, scripts/deterministic-regression.mjs, tests/unit/live-verify.test.ts, tests/unit/deterministic-regression.test.ts, vitest.config.ts, package.json, pnpm-lock.yaml, tests/golden/**, tests/integration/**, tests/unit/**, docs/specs/MH-001-rfp-xray/**, docs/agent_context/**]
exclude_paths: [src/**, drizzle/**, videos/**]
edits_allowed: false
acceptance: [AC-3, AC-4, AC-5, AC-6, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_pass
revision_round: 3
verdict: PASS
findings: { P0: 0, P1: 0, P2: 0 }
```

## T8 Publication/submission authority separation

```yaml
id: T8
owner_profile: backend
objective: Separate discarded non-submission model records from package submission safety without weakening unfamiliar-channel, citation, mapping, taint, or Q&A vetoes.
depends_on: [QA5]
include_paths: [src/lib/analysis/record-authority.ts, src/lib/analysis/materialize.ts, src/lib/runs/record-authority-audit.ts, src/lib/providers/openai.ts, tests/**, docs/specs/MH-001-rfp-xray/**]
exclude_paths: [src/app/**, src/components/**, drizzle/**]
edits_allowed: true
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10]
handoff: handoff-backend.md
status: completed_accepted
```

## QA6 T8 production-reframe review

```yaml
id: QA6
owner_profile: reviewer
objective: Independently falsify the publication/submission state split and confirm no weakening of SecureDrop, prompt-taint, mapping, citation, Q&A, or budget gates.
depends_on: [T8]
include_paths: [src/lib/analysis/**, src/lib/providers/**, src/lib/runs/record-authority-audit.ts, tests/**]
exclude_paths: []
edits_allowed: false
acceptance: [AC-2, AC-4, AC-5, AC-9, AC-10, AC-11]
handoff: qa_report.md
status: completed_approve
```
