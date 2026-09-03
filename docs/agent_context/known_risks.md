# Known Risks

Updated: 2026-09-02

| ID | Trigger | Impact | Mitigation | Owner | Status |
|---|---|---|---|---|---|
| R-1 | Monid parse schema or retention differs from assumptions | Live pipeline or privacy claim becomes invalid | Adapter uses current nested run contract; run credentialed inspect/probe; disclose provider retention as unknown | backend | open |
| R-2 | Blob/source deletion fails | Private source remains available and READY claim is false | Cleanup receipt gate, retries, sweeper, fail closed | backend | open |
| R-3 | Model fabricates page numbers or merges unrelated clauses | Material procurement error | Model emits quote/chunk only; server attaches and verifies physical pages | backend | open |
| R-4 | Amendment ordering or replacement is wrong | Superseded requirements appear active | Deterministic manifest/reconciliation rules and CER golden suite | backend | open |
| R-5 | Public demo abuse exhausts wallet | Unexpected spend or outage | Turnstile, signed session, per-principal quotas, transactional budget cap | backend | open |
| R-6 | Frontend and API contracts diverge during parallel work | Broken integration | Freeze Zod/OpenAPI types before dispatch; frontend consumes shared types | chief | open |
| R-7 | Missing external deployment credentials | Public demo cannot be published | Deliver verified local app/config first; report exact credential blocker | chief | open |
| R-8 | Copyrighted tender files enter Git | Unauthorized redistribution and repository bloat | Commit only URLs, hashes, facts, and synthetic fixtures | chief | open |
| R-9 | Deadline-driven scope expansion | Core auditability remains unfinished | Preserve must-have gates; omit search, billing, accounts, collaboration | chief | open |
| R-10 | Direct copying from ontology lacks an explicit repository license | Legal and dependency risk | Port independently verified invariants and tests, not Python/Marker source or runtime | chief | mitigated |
| R-11 | Expiry/delete cleanup fails but state becomes expired or result remains readable | Source retention and analysis disclosure after a failed deletion | Gate result reads on clean terminal state; keep cleanup retryable; test failed expiry/delete and abandoned uploads | backend | confirmed-P0 |
| R-12 | Production guest mutations lack client Turnstile tokens | Public Web is unusable or abuse protection is bypassed | Fresh action-bound token for each mutation; verify action/hostname server-side; production-path E2E | frontend/backend | confirmed-P1 |
| R-13 | Model summary bypasses SHA/page/quote verification | Invented issuer/date/method appears authoritative | Require verified matching claims for every factual summary field and adversarial tests | backend | confirmed-P1 |
| R-14 | Requirement amendment lifecycle is not reconciled | Superseded requirements remain active | Reconcile requirements with server-derived document order and full CER materialization tests | backend | confirmed-P1 |
| R-15 | Production silently selects memory/local adapters | Lost runs, bypassed quotas, and false health | Fail closed unless Workflow, Neon, Blob, Monid, OpenAI, and normalization paths are configured | backend | confirmed-P1 |
| R-16 | OpenAI request/cost is not hard bounded | Context failure or spend above reservation | Bound total serialized input/output and derive reservation/settlement from enforceable limits and token usage | backend | confirmed-P1 |
| R-17 | Monid artifact URL can target arbitrary HTTPS origins | Server-side request forgery | Pin inspected artifact origin and revalidate public-network redirects | backend | confirmed-P1 |
| R-18 | Signed upload is abandoned or replayed after deletion | Untracked source retention | Durable incoming-upload expiry/sweeper plus replay-safe deletion design | backend | confirmed-P0 |
| R-19 | High-severity vulnerable transitive packages | Known denial/disclosure vulnerabilities | Constrained patched overrides for undici/nanoid and zero-high audit | backend | open |
