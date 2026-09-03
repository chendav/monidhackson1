# Known Risks

Updated: 2026-09-03

| ID | Trigger | Impact | Mitigation | Owner | Status |
|---|---|---|---|---|---|
| R-1 | Monid parse schema or retention differs from assumptions | Live pipeline or privacy claim becomes invalid | Adapter uses current nested run contract; run credentialed inspect/probe; disclose provider retention as unknown | backend | open |
| R-2 | Blob/source deletion fails | Private source remains available and READY claim is false | Cleanup receipt gate, retries, sweeper, fail closed | backend | open |
| R-3 | Model fabricates page numbers or merges unrelated clauses | Material procurement error | Model emits quote/chunk only; server attaches and verifies physical pages and relation roles | backend | mitigated-locally; live model gate open |
| R-4 | Amendment ordering or replacement is wrong | Superseded requirements appear active | Deterministic manifest/reconciliation rules, cross-document stale-risk checks, and CER golden suite | backend | mitigated-locally; live CER gate open |
| R-5 | Public demo abuse exhausts wallet | Unexpected spend or outage | Turnstile, signed session, per-principal quotas, transactional budget cap | backend | open |
| R-6 | Frontend and API contracts diverge during parallel work | Broken integration | Freeze Zod/OpenAPI types before dispatch; frontend consumes shared types | chief | open |
| R-7 | Missing external deployment credentials | Public demo cannot be published | Deliver verified local app/config first; report exact credential blocker | chief | open |
| R-8 | Copyrighted tender files enter Git | Unauthorized redistribution and repository bloat | Commit only URLs, hashes, facts, and synthetic fixtures | chief | open |
| R-9 | Deadline-driven scope expansion | Core auditability remains unfinished | Preserve must-have gates; omit search, billing, accounts, collaboration | chief | open |
| R-10 | Direct copying from ontology lacks an explicit repository license | Legal and dependency risk | Port independently verified invariants and tests, not Python/Marker source or runtime | chief | mitigated |
| R-11 | Expiry/delete cleanup fails but state becomes expired or result remains readable | Source retention and analysis disclosure after a failed deletion | Gate result reads on clean terminal state; keep cleanup retryable; test failed expiry/delete and abandoned uploads | backend | mitigated-locally |
| R-12 | Production guest mutations lack client Turnstile tokens | Public Web is unusable or abuse protection is bypassed | Fresh action-bound token for each mutation; verify action/hostname server-side; production-path E2E | frontend/backend | mitigated-locally |
| R-13 | Model summary bypasses SHA/page/quote verification | Invented issuer/date/method appears authoritative | Require quote-level field anchors plus scalar/timezone agreement and adversarial tests | backend | mitigated-locally |
| R-14 | Requirement amendment lifecycle is not reconciled | Superseded requirements remain active | Server-order reconciliation, source-authorized mutations, CER materialization tests, and stale-risk filtering | backend | mitigated-locally |
| R-15 | Production silently selects memory/local adapters | Lost runs, bypassed quotas, and false health | Fail closed unless Workflow, Neon, Blob, Monid, OpenAI, and normalization paths are configured | backend | mitigated-locally |
| R-16 | OpenAI request/cost is not hard bounded | Context failure or spend above reservation | Bound bytes/tokens/output/cost and share one aggregate deadline across every batch | backend | mitigated-locally |
| R-17 | Monid artifact URL can target arbitrary HTTPS origins | Server-side request forgery | Pin inspected artifact origin and revalidate public-network redirects | backend | mitigated-locally |
| R-18 | Signed upload is abandoned or replayed after deletion | Untracked source retention | Durable incoming-upload expiry/sweeper plus replay-safe deletion design | backend | mitigated-locally; live Blob gate open |
| R-19 | Vulnerable transitive packages | Known denial/disclosure vulnerabilities | Constrained overrides, zero-high/critical audit, and monitor remaining drizzle-kit development-chain moderate | backend | mitigated; monitor moderate advisory |
| R-20 | Process crashes after durable run creation but before Workflow start | Active slot remains queued and never analyzes | Idempotent replay plus indexed bounded maintenance admission recovery | backend | mitigated-locally; deployed crash test open |
| R-21 | Presign requests bypass run quotas and exhaust Blob/storage | Cost or denial of service before run creation | Atomic owner/quota/global issuance locks with retained daily usage events | backend | mitigated-locally; Neon concurrency test open |
| R-22 | Concurrent or ambiguously acknowledged Workflow admission duplicates or destroys a run | Duplicate paid work, orphan workflow, or premature source cleanup | Single-writer admission lease, processing CAS, queued retry on uncertain acknowledgement | backend | mitigated-locally; live Workflow gate open |
| R-23 | A model borrows adjacent labels or a false topic to mutate another field | Wrong title/deadline or silent supersession | Field-local spans, source-derived deadline keys, object-bound mutation clauses, needs-review fallback | backend | mitigated-locally |
| R-24 | Cleanup recreates a zero-byte fence after its durable upload ledger was swept | Permanent untracked Blob object | Ledger-first purge; absent ledger never writes and any orphan object is conditionally removed | backend | mitigated-locally; live Blob gate open |
| R-25 | Conditional, negative, comparative, or adjacent prose lends authority to the wrong fact | Unsupported mandatory/deadline/selection/submission result | Field-local affirmative relation parsers, objective tuple completeness, and fail-closed needs-review output | backend | mitigated-locally; live model gate open |
| R-26 | A later document repeats a superseded scalar in a risk | Old deadline or amount remains actionable | Cross-document server-derived lineage and invalidated-scalar filtering | backend | mitigated-locally; live CER gate open |
