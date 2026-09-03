# RFP X-Ray

RFP X-Ray turns a user-supplied tender pack into an evidence-backed brief,
compliance matrix, evaluation model, amendment history, risk review, and
closed-world Q&A.

> Document-only. No tender search. RFP X-Ray does not write proposals or claim
> a win probability.

## Trust boundary

- Monid/context.dev is the production normalization adapter for user-supplied
  PDF inputs; the current public contract does not accept Office files.
- PDF.js creates the authoritative 1-based physical-page index.
- Models return evidence text and chunk identifiers, never page numbers.
- The server verifies quotes against the page index and binds receipts to the
  source SHA-256 before showing a definitive claim.
- A run cannot become `ready` until application-controlled source and temporary
  artifacts have confirmed purge receipts.
- Provider-side retention is disclosed separately and is never described as
  deleted unless the provider exposes verifiable proof.

## Local development

Requirements: Node.js 22.13 or newer and pnpm 10.14.

```bash
pnpm install --frozen-lockfile
copy .env.example .env.local
pnpm dev
```

Open <http://localhost:3000>. Without provider or database credentials, the app
uses deterministic local adapters and an in-memory run store. This mode exists
for development and test evidence; the UI labels it and never presents it as a
paid-provider execution.

Live provider credentials stay server-side. Do not commit `.env.local`, PDFs,
parsed Markdown, signed object-storage URLs, or tender contents.

## Quality gates

```bash
pnpm check
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

The golden suites encode the stable Edmonton document checks and the CER
amendment ordering/replacement/conflict checks without redistributing the source
PDFs. Credentialed live probes are separate from deterministic CI. The
default-skipped Railway and Neon probes can be invoked through
`pnpm test:live:storage` and `pnpm test:live:neon` only after their explicit
environment gates and credentials are supplied. `pnpm verify:live` remains
read-only unless `RFP_XRAY_ALLOW_PAID_LIVE=true` is set exactly.

## API

The versioned surface is rooted at `/api/v1`. OpenAPI is served at
`/api/openapi.json`, health at `/api/health`, and the public Edmonton sample at
`/api/v1/samples/edmonton`.

The public API uses a pre-provisioned Bearer key. The browser surface uses a
signed guest session and Turnstile in production. Local fallback behavior is
described in the health and audit responses rather than hidden.

## Deployment

The target runtime is Vercel with Vercel Workflow, a dedicated private Railway
S3-compatible Bucket, and Neon Postgres. Railway hosts no compute service for
the contest build. Vercel Private Blob remains a local/test compatibility
adapter, but cannot satisfy production readiness until it has an equivalent
target-bound, expiring safety attestation.
Configure the variables documented in `.env.example`, apply the checked-in
Drizzle migrations, run every quality gate, then deploy from `main`.

See [`docs/specs/MH-001-rfp-xray`](docs/specs/MH-001-rfp-xray) for the product
contract, provider boundary, acceptance gates, and independent review record.
