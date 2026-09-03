# QA Regressions

Updated: 2026-09-03

| ID | Fragile behavior | Required check | Last result |
|---|---|---|---|
| QR-1 | Edmonton PDF has 55 physical pages although the printed body ends at 47 | Golden page/form audit test | pass: 55 pages, 221 fields, 231 widgets |
| QR-2 | M3 means up to three resources, not exactly three | Edmonton mandatory golden test | pass |
| QR-3 | Blank pricing placeholders are unknown, never zero | Edmonton pricing golden test | pass for p40-p42 |
| QR-4 | Edmonton Annex D/E security cross-reference is inconsistent | Conflict golden test | pass |
| QR-5 | CER amendment order must not depend on upload order | Permutation reconciliation test | pass at helper and materialization levels |
| QR-6 | Amendment 003 contains an unresolved 2050/2055 contradiction | Three-citation conflict test | pass with p2/p5/p6 despite topic drift |
| QR-7 | Superseded claims and requirements remain auditable but are not current | CER materialization replacement regression | pass; dependent stale risk withheld |
| QR-8 | Any cleanup failure blocks both terminal success and result reads | Pipeline, expiry, DELETE, and result-route regressions | pass locally |
| QR-9 | PDF instructions, JavaScript, and links remain inert | Closed-world injection test | pass locally |
| QR-10 | Critical citation page and quote accuracy remain 100% | Golden citation validator and reviewer click test | pass locally; 113 occurrences/109 unique official citations |
| QR-11 | Guest mutations obtain a fresh Turnstile token in production | Production-path browser and server-verifier tests | pass locally; deployment open |
| QR-12 | Missing live infrastructure never selects memory/local production adapters | Health and production-config tests | pass |
| QR-13 | Model request bytes/tokens and maximum cost stay within reservation | Adversarial 300-page/large-chunk unit test | pass; aggregate deadline added |
| QR-14 | Monid artifact fetch cannot reach arbitrary/private hosts or redirects | SSRF adapter tests | pass locally |
| QR-15 | Abandoned/replayed signed uploads are removed by a durable sweep | Blob adapter/workflow tests | pass locally; live Blob gate open |
| QR-16 | Reused model IDs combine one record's prose with another record's citations | Cross-batch ID and direct materialization adversarial tests | pass |
| QR-17 | Labels and numbers are semantically swapped (70/30, 50/94, MDT/EST) | Field-binding citation tests | pass |
| QR-18 | Run row survives a crash before Workflow scheduling | Idempotent replay and maintenance recovery tests | pass locally |
| QR-19 | Presign flood bypasses run quota | Outstanding/daily/global concurrent issuance tests | pass locally; live Neon gate open |
