# Runtime Decision: Vercel, Not Railway

Decided: 2026-09-02.

## Decision

Keep the contest deployment on Vercel + Workflow + Private Blob + Neon. Do not
add a Railway service for the current document-only pipeline.

The live provider pipeline requires Vercel Pro with Fluid Compute. Hobby mode is
limited to the deterministic sample/local fallback and must not be presented as
supporting the live Monid pipeline.

## Why this is not an always-on workload

- The browser creates a run and receives `202`; it does not hold an HTTP request
  open until analysis finishes.
- Workflow owns scheduling, durable invocation, observability, and recovery.
- Neon owns durable application state; Private Blob owns bounded source objects.
- Monid/context.dev performs remote OCR/normalization, so the application does
  not host a native OCR daemon or persistent worker.
- Status polling is client-to-API polling over persisted state, not a WebSocket
  or process-local timer.

## Privacy-driven step boundary

Workflow step results are persisted for replay. Passing raw page indexes or
parsed Markdown between many durable steps would therefore create another raw
content retention surface. For the contest version, raw content remains inside
one bounded step and is erased before a result is released.

The generated Workflow step endpoint uses the plan maximum. The application
adds these narrower controls:

- Vercel Pro/Fluid step ceiling: 800 seconds.
- Aggregate source download + Monid phase: 600 seconds.
- OpenAI client: one 120-second attempt with SDK retries disabled.
- Whole-pipeline Workflow retry: disabled to prevent duplicate paid calls after
  a late cleanup or persistence failure.
- Remaining headroom is reserved for PDF indexing, reconciliation, persistence,
  and fail-closed cleanup.

This is an explicit contest tradeoff, not a claim that a single large step is
the ideal high-scale architecture. A later version may store encrypted
short-lived intermediates in Blob and split the workflow further after its
retention and deletion evidence is specified.

## When Railway becomes appropriate

Reconsider Railway or another worker runtime only if the product starts to:

- self-host Tesseract, Marker, LibreOffice, browser automation, or model serving;
- require a permanently listening queue consumer or WebSocket server;
- need local disk across tasks;
- exceed the bounded Vercel step memory or time limit in measured production
  runs; or
- run enough sustained CPU work that container economics beat serverless.

Railway is not free persistence: an awake service is billed for allocated CPU
and memory, and its serverless sleep mode adds a cold boot and may return a 502
on the waking request. Introducing it now would add a second deploy, queue,
restart policy, secret surface, and cost ledger without removing Neon, Blob, or
the need for idempotency.

## Revalidation gate

Before the final demo, record ten Edmonton durations and one full CER duration.
If any live run approaches 720 seconds, stop admitting new public runs and
either split encrypted temporary artifacts across durable steps or move only
the heavy parsing worker to Railway. Do not silently raise the public promise.

## Official references

- https://vercel.com/workflows
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/fluid-compute
- https://docs.railway.com/pricing
- https://docs.railway.com/deployments/serverless
