# Current System State

Updated: 2026-09-03

## Confirmed

- The repository is initialized on `main`, is connected to origin, and Revision
  2 through commit `230e382` is pushed. Revision 3 is an uncommitted review
  candidate.
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
- Exact-commit review of `230e382` found P0=0/P1=4: copied Markdown lifetime,
  aggregate OpenAI deadline, cancellation spend settlement, and stranded run
  admission. The Revision 3 candidate fixes all four with regressions.
- Specialist findings for duplicate model IDs, model-authorized supersession,
  evaluation/summary semantic laundering, topic-drift conflict loss, stale
  risks, and unbounded presign issuance are fixed in the candidate.
- Current local evidence: `pnpm check` 104/104 tests with 3 optional skips;
  official fixture audit 3/3; build pass with 9 steps/3 workflows; Playwright
  14/14; zero high dependency advisories.

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
