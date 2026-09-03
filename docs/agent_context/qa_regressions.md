# QA Regressions

Updated: 2026-09-02

| ID | Fragile behavior | Required check | Last result |
|---|---|---|---|
| QR-1 | Edmonton PDF has 55 physical pages although the printed body ends at 47 | Golden page/form audit test | pending |
| QR-2 | M3 means up to three resources, not exactly three | Edmonton mandatory golden test | pending |
| QR-3 | Blank pricing placeholders are unknown, never zero | Edmonton pricing golden test | pending |
| QR-4 | Edmonton Annex D/E security cross-reference is inconsistent | Conflict golden test | pending |
| QR-5 | CER amendment order must not depend on upload order | Permutation reconciliation test | pending |
| QR-6 | Amendment 003 contains an unresolved 2050/2055 contradiction | Three-citation conflict test | pending |
| QR-7 | Superseded claims remain auditable but are not rendered as current | CER replacement regression test | pending |
| QR-8 | A cleanup failure cannot transition to READY | State-machine and integration failure test | pending |
| QR-9 | PDF instructions, JavaScript, and links remain inert | Closed-world injection test | pending |
| QR-10 | Critical citation page and quote accuracy remain 100% | Golden citation validator and reviewer click test | pending |
