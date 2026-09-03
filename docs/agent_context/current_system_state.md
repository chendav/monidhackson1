# Current System State

Updated: 2026-09-03

## Confirmed

- The repository is initialized on `main`, is connected to origin, and the
  independently approved local release candidate is commit `cc2831c`.
- Next.js Web/API, local deterministic pipeline, Neon/Blob/Workflow adapters,
  Monid/OpenAI adapters, golden fixtures, and automated tests are implemented.
- There is no `.codegraph/` directory and no existing application scaffold.
- The selected target is bidworx Starter at its current public £190/month price.
- Edmonton RFP 100022184-A is a 55-page closed development fixture.
- CER 84084-26-0009/A plus amendments 001-003 is the final live package.
- Vercel Functions have a 4.5MB request/response body limit; browser uploads
  therefore require signed direct Blob upload rather than multipart API proxy.
- Official OpenAI documentation currently supports Responses API Structured
  Outputs with the JavaScript SDK and Zod helpers.
- Monid CLI 0.1.7 is installed from the official scoped package
  `@monid-ai/cli`; the local Monid keystore currently has no configured key.
- Current Monid run input is nested under `input.body`, `input.queryParams`, and
  `input.pathParams`; adapter code must not rely on older flat examples.
- Context.dev parse currently advertises a 25MB limit, a short-lived Markdown
  download link, and a longer provider-side artifact lifetime.
- Ontology's reusable strengths are fail-closed SHA/page/quote verification,
  append-only receipts, conflict preservation, and bounded grounded queries.
- Evidence validation now binds polarity, modality, objective bounds, scalar
  roles, deadline and submission objects, selection outcomes, mandatory
  predicates, and source-authorized mutation targets to local source spans.
- Reconciliation preserves subfield identities, complete-document replacements,
  amendment ordering, conflicts, and stale-risk invalidation across documents.
- Current local evidence: `pnpm check` 234 passed/3 optional skips; official
  fixture audit 3/3; build pass with 9 steps/3 workflows and 13 static pages;
  Playwright 14/14; zero high/critical dependency advisories and one moderate
  development-chain advisory.
- Bounded reconciliation and security reviewers both returned APPROVE with
  P0=0/P1=0. The final Independent Reviewer returned PASS with P0=0/P1=0 for
  `cc2831c`.

## Inferred

- A single Next.js application with Neon and Vercel Workflow is the lowest
  coordination-cost architecture for the eight-day build.

## Unknown

- Exact account-visible context.dev inspect schema, ZDR propagation, signed-URL
  compatibility, and provider deletion semantics require a credentialed spike.
- Vercel, Neon, Blob, Turnstile, and deployment credentials are not yet verified.
- Full-document extraction quality of the configured OpenAI model is not yet
  verified. A live count probe and exact-schema synthetic Structured Output
  probe succeeded.

## Active Constraints

- Follow applicable repository governance and the MH-001 task packet.
- Do not store secrets, raw PDFs, raw parsed Markdown, or signed source URLs.
- Preserve user-authored untracked governance files and unrelated work.
- Node must be at least 22.13 because of the installed PDF.js runtime.
- Current runtime decision remains Vercel Pro + Fluid Compute, not Railway. Local
  memory adapters are development/test only and production must fail closed.
