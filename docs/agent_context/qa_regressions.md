# QA Regressions

Updated: 2026-09-02

| ID | Fragile behavior | Required check | Last result |
|---|---|---|---|
| QR-1 | Edmonton PDF has 55 physical pages although the printed body ends at 47 | Golden page/form audit test | local pass; expand to 221 fields/231 widgets |
| QR-2 | M3 means up to three resources, not exactly three | Edmonton mandatory golden test | pass |
| QR-3 | Blank pricing placeholders are unknown, never zero | Edmonton pricing golden test | partial; cover p40-p42 |
| QR-4 | Edmonton Annex D/E security cross-reference is inconsistent | Conflict golden test | pass |
| QR-5 | CER amendment order must not depend on upload order | Permutation reconciliation test | pure-helper pass; materialization coverage missing |
| QR-6 | Amendment 003 contains an unresolved 2050/2055 contradiction | Three-citation conflict test | fix to amendment p2/p5/p6 |
| QR-7 | Superseded claims and requirements remain auditable but are not current | CER materialization replacement regression | fail: requirements stay active |
| QR-8 | Any cleanup failure blocks both terminal success and result reads | Pipeline, expiry, DELETE, and result-route regressions | fail-P0 |
| QR-9 | PDF instructions, JavaScript, and links remain inert | Closed-world injection test | pass locally |
| QR-10 | Critical citation page and quote accuracy remain 100% | Golden citation validator and reviewer click test | fixture pass; summary bypass fails |
| QR-11 | Guest mutations obtain a fresh Turnstile token in production | Production-path browser and server-verifier tests | fail-P1 |
| QR-12 | Missing live infrastructure never selects memory/local production adapters | Health and production-config tests | fail-P1 |
| QR-13 | Model request bytes/tokens and maximum cost stay within reservation | Adversarial 300-page/large-chunk unit test | fail-P1 |
| QR-14 | Monid artifact fetch cannot reach arbitrary/private hosts or redirects | SSRF adapter tests | fail-P1 |
| QR-15 | Abandoned/replayed signed uploads are removed by a durable sweep | Blob adapter/workflow tests | fail-P0 |
