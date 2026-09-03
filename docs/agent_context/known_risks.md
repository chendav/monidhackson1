# Known Risks

Updated: 2026-09-02

| ID | Trigger | Impact | Mitigation | Owner | Status |
|---|---|---|---|---|---|
| R-1 | Monid parse schema or retention differs from assumptions | Live pipeline or privacy claim becomes invalid | Run discover/inspect/paid spike first; gate adapter and disclosure on verified facts | backend | open |
| R-2 | Blob/source deletion fails | Private source remains available and READY claim is false | Cleanup receipt gate, retries, sweeper, fail closed | backend | open |
| R-3 | Model fabricates page numbers or merges unrelated clauses | Material procurement error | Model emits quote/chunk only; server attaches and verifies physical pages | backend | open |
| R-4 | Amendment ordering or replacement is wrong | Superseded requirements appear active | Deterministic manifest/reconciliation rules and CER golden suite | backend | open |
| R-5 | Public demo abuse exhausts wallet | Unexpected spend or outage | Turnstile, signed session, per-principal quotas, transactional budget cap | backend | open |
| R-6 | Frontend and API contracts diverge during parallel work | Broken integration | Freeze Zod/OpenAPI types before dispatch; frontend consumes shared types | chief | open |
| R-7 | Missing external deployment credentials | Public demo cannot be published | Deliver verified local app/config first; report exact credential blocker | chief | open |
| R-8 | Copyrighted tender files enter Git | Unauthorized redistribution and repository bloat | Commit only URLs, hashes, facts, and synthetic fixtures | chief | open |
| R-9 | Deadline-driven scope expansion | Core auditability remains unfinished | Preserve must-have gates; omit search, billing, accounts, collaboration | chief | open |
