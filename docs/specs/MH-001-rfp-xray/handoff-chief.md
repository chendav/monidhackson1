# Chief Foundation Handoff

## Assignment

Freeze provider facts, scaffold, shared contracts, and task ownership boundaries.

## Inspected Files

- AGENTS.md
- docs/agents/chief_agent.md
- docs/agents/chief_config.yaml
- docs/agents/role_catalog.yaml
- docs/specs/template/*

## Changed Files

- Task packet, four current-context files, registry, application scaffold,
  package manifest/lockfile, Next/Workflow configuration, shared Zod contracts,
  metadata, and the first meaningful working-surface preview.

## Decisions

- One Next.js application; backend and frontend own disjoint paths after contracts freeze.
- Vercel/Neon remains authoritative over the generic Sites/Cloudflare hosting default.
- Workflow SDK 4.8.5 wraps Next 16.3.4; generated `.well-known` routes remain ignored.
- OpenAI integration uses Responses Structured Outputs with Zod parsing.
- URL ingestion is CanadaBuys-only; all other sources use signed upload.
- Ontology concepts will be reused for SHA provenance, quote verification, conflict
  preservation, and grounded queries; its pypdf-only extraction is not copied as
  the sole complex-PDF parser.

## Confirmed

- Repository has no existing application or commit history.
- No CodeGraph index exists.
- The first Next.js production build and local HTTP preview succeeded.
- Vercel request bodies are too small for direct 25MB API uploads; Private Blob
  signed PUT/GET is the fixed ingress path.

## Inferred

- Shared contracts must land before parallel implementation.

## Unknown

- Credentialed Monid and deployment facts remain to be verified.

## Checks and Exact Outcomes

- Chief packet validator: PASS.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS.
- `pnpm build`: PASS; root route and Workflow infrastructure compiled.
- Local preview `GET /`: HTTP 200.

## Assumptions

- User's implementation request authorizes repository edits and planned public deployment.

## Risks

- See docs/agent_context/known_risks.md.

## Follow-ups

- Backend and frontend implement against the frozen shared contracts.
- Merge provider research into the Monid adapter without guessing unverified fields.

## Proposed Long-Term Memory

- None.

## Memory Disposition

- None.
