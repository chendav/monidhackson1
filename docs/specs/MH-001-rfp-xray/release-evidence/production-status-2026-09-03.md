# Production Status — 2026-09-03

Observed at `2026-09-03T19:10:54Z`.

## Release identity

- Release Git SHA: `76e0f4e01f93d67eab4da9b98807959b81578396`.
- Application-code parent: `fbb48d09bda4f8d671f6b1679c66d3e0400f45db`.
- GitHub Actions run: `33793276409`, successful.
- Vercel production deployment: `dpl_5dMrPWKGMCKxy5hcQUfq57uLmZce`.
- Immutable deployment URL:
  `https://rfp-xray-3dpwofwgr-chendavs-projects.vercel.app`.
- Public alias: `https://rfp-xray.vercel.app`.

## Deployment-bound receipts

- Runtime receipt payload SHA-256:
  `5d50e812e28ee43fdc81bd99c8a2a291a737ff3c607ccb2d148cbba97aa14dbf`;
  expires `2026-09-04T19:00:58.845Z`.
- Monid/OpenAI provider-contract receipt payload SHA-256:
  `0c8ede2c44fc3ff8038eea7640573bdef5cbbb0523ae7583e66b5e8f1743fe07`;
  expires `2026-09-04T19:01:09.386Z`.

Receipts are bound to this deployment and must not be copied to a later one.

## Public checks

The production Playwright smoke passed 4/4 against the public alias: landing,
OpenAPI, SHA-bound Edmonton sample, and truthful health behavior.

`GET /api/health` returned `503 not_ready`. Its dependencies reported:

- database: `ready`;
- Neon capacity: `attested`;
- maintenance: `fresh`;
- private storage: `attested`;
- Workflow: `attested_300s`;
- Monid: `actively_verified`;
- OpenAI: `actively_verified`;
- storage provider: `railway_s3`;
- storage safety: `current`.

The only missing configuration was:

- `TURNSTILE_SECRET_KEY`;
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`;
- `TURNSTILE_EXPECTED_HOSTNAME`.

This proves the release is correctly fail-closed. It does not prove a live
guest mutation, the eleven-run paid campaign, end-to-end recovery, production
citation click-through, measured campaign cost/latency, or contest completion.

