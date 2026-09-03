# Execution Plan

Task ID: MH-001

## Sequence

1. Freeze provider contracts, public types, fixture manifests, and privacy wording.
2. Scaffold one Next.js application and shared contracts.
3. Implement persistence, ingestion, workflow, parsing, cleanup, analysis, and API.
4. Implement the English working surface against the frozen contracts.
5. Integrate, run automated/golden/browser checks, and write implementation handoffs.
6. Run independent QA and issue only acceptance-scoped delta revisions.
7. Validate deployment configuration; publish only when credentials are available.

## Dependencies

- T1 precedes T2 and T3 because both consume shared contracts and scaffold.
- T2 and T3 own disjoint paths and may run in parallel after T1.
- QA1 starts only after both implementation handoffs and Chief integration checks.

## Ownership

- Chief: governance, scaffold/contracts, integration, provider spike, release evidence.
- Backend: `src/lib/**`, API routes, workflow, database, tests excluding browser UI.
- Frontend: pages/components/styles and browser-facing tests only.
- Reviewer: read-only independent evaluation.

## Verification

- Static checks, unit/integration/golden tests, production build, Playwright.
- Live provider smoke tests only when secrets are available; never print secrets.
- Reviewer verifies acceptance IDs and at least 12 critical citations when live.

## Recovery

- All jobs are idempotent and checkpointed; cleanup retries fail closed.
- Preserve the last buildable commit and use additive database migrations.
- Omit optional polish before weakening cleanup, citations, or golden correctness.
