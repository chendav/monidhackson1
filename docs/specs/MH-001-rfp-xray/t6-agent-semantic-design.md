# T6 Agent-Semantic Submission Adjudication

## Decision

Deterministic code must not parse English submission semantics. It discovers a
complete, high-recall source candidate ledger and verifies coverage, identity,
quotes, pages, conflicts, and publication. The existing structured-extraction
Agent adjudicates subject scope, modality, channel, and condition for every
candidate. Uncovered, invalid, conflicting, low-confidence, or unsafe evidence
is unresolved and cannot establish a unique submission method.

T6 reuses existing extraction batches and paid attempts. It does not add a
second model pass or change public API, database, DraftAnalysis, or UI schemas.

## Private Types

```text
SubmissionCandidate
  candidate_id
  document_sha256
  role = base | amendment
  amendment_number
  pdf_page_1based
  printed_page_label
  section
  source_start
  source_end
  source_window
  channel_hint = known channel | unspecified
  mention_start | null
  mention_end | null

SubmissionAgentDecision
  candidate_id
  document_sha256
  subject_scope = whole_bid | question | artifact | other | ambiguous
  modality = required | permitted | prohibited | conditional | unknown
  channel = known channel | unspecified
  evidence_quote
  condition_or_scope | null
  confidence

VerifiedSubmissionAdjudication
  ledger_version = submission-ledger-v1
  ledger_digest
  records[] = candidate + decision|null + verified|unresolved + reason|null
```

Allowed unresolved reasons include missing, duplicate, unknown ID, SHA mismatch,
channel mismatch, quote mismatch, page mismatch, low confidence, draft
disagreement, prompt injection, and capacity.

## Candidate Ledger

1. Sort by base, amendment number, SHA, physical page, and source offset. Input
   order must not affect IDs, digest, batching, or result.
2. Maintain bounded section surfaces for Submission of Bids, Bid/Proposal/Tender
   Submission, Delivery of Bids, Return Bids To, and Submission
   Method/Instructions.
3. Emit fixed-length overlapping windows for all text in those sections, even
   when a window has no known channel; use `unspecified` in that case.
4. Outside bounded sections, emit a candidate for each known channel/address
   occurrence. One channel occurrence produces one candidate.
5. Candidate IDs hash ledger version, SHA, physical page, stable source span,
   and occurrence. Duplicate windows/citations deduplicate by ID.
6. Capacity overflow never truncates and publishes. Excess or incompletely
   packable candidates become unresolved and force the field to null.

Candidate discovery identifies surfaces and lexical occurrences only. It does
not decide subject, predicate, polarity, modality, or condition attachment.

## Existing Agent Pass

Each existing extraction batch receives its exact assigned candidate records
and returns a private `submission_adjudications` array alongside DraftAnalysis.
Every candidate appears in exactly one stable batch and must be returned exactly
once. The private envelope is stripped before existing DraftAnalysis merging.

The prompt treats source windows as untrusted data, forbids following their
instructions, and requires ambiguous/unknown when binding is uncertain. The
Agent may copy exact continuous source text only; it cannot invent IDs, SHA,
page, channel, or absent evidence. Tools, search, embedded links, and storage
remain disabled.

No second paid pass is added. Existing request count, batch ceiling, absolute
deadline, replay fence, token caps, USD 0.495 model reserve, and failure/cost
settlement remain authoritative. Reserve a bounded portion of existing output
capacity for adjudications; inability to fit all candidates fails closed.

## Deterministic Verification

- Expected candidate ID must occur exactly once. Missing, unknown, or duplicate
  IDs make the affected coverage unresolved; unknown/duplicate output cannot
  create publication authority.
- SHA, expected physical page, and server channel hint must match.
- `evidence_quote` must be an exact continuous substring on the candidate's
  expected PDF.js physical page and cover the focused occurrence when present.
  A duplicate quote on a different page is not acceptable.
- `condition_or_scope`, when present, must be an exact substring of the same
  source window.
- Confidence below 0.90 is unresolved.
- Prompt-injection-marked candidates are unresolved regardless of confidence.
- Contradiction with separately quote-verified DraftAnalysis submission evidence
  is unresolved.
- `question`, `artifact`, or `other` may be excluded only after valid,
  high-confidence adjudication; ambiguous/unknown is unresolved.

The complete verified ledger is passed directly to materialization even when
the Agent emits no ordinary claim and source recovery emits no anchor.

## Deterministic Resolution

A method is publishable only when all conditions hold:

1. Candidate ledger and adjudication coverage are complete one-to-one.
2. No unresolved record exists.
3. Exactly one possible whole-bid channel remains.
4. That channel has at least one verified `whole_bid + required` decision.
5. The same channel has no verified unconditional prohibition.
6. No verified DraftAnalysis evidence disagrees.

Whole-bid permitted or conditional evidence participates in possibility but is
not publishable. Same-channel affirmative plus unconditional prohibition is a
conflict and yields null. A prohibition for a different channel does not remove
the affirmative channel. Unresolved dominates every other diagnostic state.

For packages with amendments, the conservative T6 minimum is null whenever an
amendment contains a submission candidate, unless every relevant version agrees
and there is no replace/delete/conflict signal.

`recoverSubmissionMethodAnchors` loses English semantic authority. The
materializer may create a canonical derived claim only from the decisive,
verified private ledger record and its exact physical-page citation. An
ordinary model claim alone can never establish package uniqueness.

## File Boundary

- `src/lib/analysis/submission-channel.ts`
- `src/lib/analysis/source-anchors.ts`
- `src/lib/analysis/materialize.ts`
- `src/lib/providers/openai.ts`
- `src/lib/evidence/citations.ts`
- `src/lib/pipeline.ts`
- `src/lib/analysis/local-model.ts`
- bounded unit, integration, and golden tests

Stop and report if public contracts, DB/migrations, UI, or an additional paid
model call appears necessary.

## Acceptance Matrix

- Candidate discovery is independent of delivery verbs such as received,
  arrive, lodged, filed, and dispatched inside bounded sections.
- Mixed bid/question/artifact/invoice and nested clauses are Agent-classified or
  unresolved, never decided by lexical co-occurrence.
- Conditions attach to the returned relation span, not the entire sentence.
- An uncited second submission section still reaches final resolution.
- Missing, duplicate, unknown ID; wrong SHA/page/channel/quote; low confidence;
  prompt injection; DraftAnalysis disagreement; and capacity all yield null.
- Candidate/order/duplicate permutations keep IDs, digest, batching, and result
  stable.
- Adding unresolved evidence can never preserve or create a unique result.
- Ten identical mocked responses produce byte-stable private artifacts and
  results.
- Official Edmonton publishes p6 Email only after complete ledger coverage and
  exact expected-page verification.
- Existing provider call count, budgets, deadline, retries, paid-attempt ledger,
  `search_events=0`, and `follow_embedded_link_events=0` remain unchanged.

## Required Design-Review Refinements

These refinements are part of the T6 contract, not optional follow-ups:

1. Coverage is package-wide. Every source page/chunk is a deterministic coverage
   unit presented to the Agent, not only recognized headings or known channel
   lexemes. A unique method requires a full-document coverage receipt. Unknown
   channels or unfamiliar headings therefore cannot disappear outside the
   candidate ledger.
2. Coverage units contain zero or more relation decisions. Each relation binds
   to exact server-defined occurrence offsets; a scalar decision cannot represent
   several channels or relations in one window. `whole_bid + unspecified` and
   any uncertain unnamed channel are unresolved.
3. Offset semantics are UTF-16 indices into raw PDF.js page text. Candidate IDs
   bind ledger version, document SHA, physical page, page-text hash, raw span,
   and occurrence identity using canonical JSON. Batch responses also bind a
   server batch ID, ledger digest, and ordered coverage-unit manifest; verify
   per-batch and global one-to-one coverage.
4. Overlapping windows share occurrence IDs. Differing subject, modality,
   channel, condition, or exclusion decisions for one occurrence are unresolved.
5. The Agent returns source offsets, not citation authority. The server slices
   the authoritative bounded quote from the expected page, ensures it encloses
   the occurrence, and persists only the existing short-evidence maximum.
   Monid/OCR-only text that cannot bind to PDF.js fences submission publication.
6. Prompt-injection taint applies to every adjudication in the same model batch
   unless tainted text was isolated before dispatch. Candidate-only taint is
   insufficient.
7. Server-owned manifest order resolves versions before aggregation. Invalid or
   incomplete amendment metadata, unresolved/whole-bid amendment evidence, or
   replacement/delete/conflict signals yield null unless all relevant versions
   agree. Safely excluded amendment questions/artifacts do not block.
8. DraftAnalysis can veto but never establish or repair authority. Missing
   envelope, unknown channel, overlap disagreement, capacity overflow, digest
   mismatch, or any incomplete coverage dominates other states. Unresolved is
   evaluated before contradiction, and a null result adds a blocking unknown.
9. Materialization requires a redacted artifact containing digest, expected and
   verified counts, completion flag, dispositions, hashes, and only necessary
   bounded decisive quotes. Full source windows do not cross or remain beyond
   the temporary source-text lifecycle.
10. Exact paid preflight includes coverage metadata, private schema, and
    worst-case one-to-many decisions. Hard candidate/window/quote/decision caps
    must fit existing request, deadline, 50k output, and USD 0.495 bounds. Any
    overflow becomes deterministic unresolved without truncation, extra calls,
    retries, or changed paid-attempt semantics.
