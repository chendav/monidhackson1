# Current System State

Updated: 2026-09-02

## Confirmed

- The repository is initialized and has an origin remote, but has no commits.
- The working tree contains only Chief Agent governance and planning documents.
- There is no `.codegraph/` directory and no existing application scaffold.
- The selected target is bidworx Starter at its current public £190/month price.
- Edmonton RFP 100022184-A is a 55-page closed development fixture.
- CER 84084-26-0009/A plus amendments 001-003 is the final live package.
- Vercel Functions have a 4.5MB request/response body limit; browser uploads
  therefore require signed direct Blob upload rather than multipart API proxy.
- Official OpenAI documentation currently supports Responses API Structured
  Outputs with the JavaScript SDK and Zod helpers.

## Inferred

- A single Next.js application with Neon and Vercel Workflow is the lowest
  coordination-cost architecture for the eight-day build.

## Unknown

- Exact current Monid discover/inspect/run schemas, unit price, result-link TTL,
  provider retention, and deletion semantics require a credentialed spike.
- Vercel, Neon, Blob, Turnstile, and deployment credentials are not yet verified.
- Availability and measured extraction quality of the configured OpenAI model
  are not yet verified.

## Active Constraints

- Follow applicable repository governance and the MH-001 task packet.
- Do not store secrets, raw PDFs, raw parsed Markdown, or signed source URLs.
- Preserve user-authored untracked governance files and unrelated work.
