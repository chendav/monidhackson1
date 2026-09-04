# T7 Record-Bound Agent Semantic Authority

> T8 refines this design by separating non-submission publication failure from
> submission safety. The provider annotation wire remains v1; server authority
> receipts are v2. See `reframing_review.md` for the current disposition model.

## Decision

T6 is closed without acceptance after QA4 exhausted three revision rounds. Its
remaining defect is architectural: one valid known relation turns on a global
authority flag and can admit an unrelated model record that contains an
unfamiliar contradictory submission method.

T7 removes package-wide admission of free-form model output. The same paid
structured extraction response must classify every model-authored record and
bind that decision to server-issued coverage units and exact citations. The
Agent owns semantic classification. The server owns identity, completeness,
source binding, version order, disagreement, and publication policy.

No public `AnalysisResult`, API, database, or UI schema changes are required.
No second model call, retry, search, embedded-link action, or provider endpoint
is added.

## Provider-Private Shape

The internal extraction envelope adds one compact sidecar. It is stripped
before ordinary DraftAnalysis merging and is never persisted as public output.

```ts
type RecordKind = "c" | "q" | "r" | "e";
// c=claim, q=requirement, r=risk, e=evaluation rule

type SubmissionRelevance = "s" | "n" | "u";
// s=submission-method relevant, n=not relevant, u=uncertain

type RecordAuthorityAnnotation = [
  kind: RecordKind,
  ordinal: number, // zero-based array ordinal in this batch's collection
  relevance: SubmissionRelevance
];

type RecordAuthorityEnvelope = {
  v: 1;
  r: RecordAuthorityAnnotation[];
};
```

The Agent returns relevance only. It does not guess page offsets or bind a
candidate. After every batch has returned, the server globally joins the
annotation to the record's exact verified PDF.js citation spans and the complete
verified candidate/relation ledger. This avoids impossible pre-output
citation/candidate co-packing with Monid Markdown fragments.

The provider-private schema freezes these caps:

```text
MAX_RECORD_AUTHORITY_ANNOTATIONS_PER_BATCH = 40
MAX_MODEL_CITATIONS_PER_ANNOTATED_RECORD = 3
MAX_SUBMISSION_COVERAGE_UNITS = 160 (existing)
MAX_SUBMISSION_RELATIONS_PER_UNIT = 10 (existing)
```

The Agent must return exactly one annotation for every Claim, Requirement,
Risk, and Evaluation rule it emits. A batch with more than 40 such records or a
record with more than three citations cannot produce an authoritative envelope.
If any annotation is missing, duplicated, or unknown, the authority receipt is
incomplete and publication fails closed. Model IDs never establish identity.

## Server-Owned Identity

For each parsed batch record, the server derives:

```text
record_key = SHA256(
  authority_version,
  batch_id,
  record_kind,
  array_ordinal,
  canonical_public_record_json
)
```

The verified ephemeral receipt contains the record key, batch ID, kind,
relevance, a canonical merged-record digest that excludes only the model ID
while retaining every semantic field, SHA, and citation, server-derived exact citation spans, globally matched
coverage/relation bindings, disposition, and reason. It contains no source
window. It travels beside the Draft records through ID disambiguation and merge,
then is consumed by materialization.

Batch merge is atomic and returns:

```text
merged_draft
origin_record_key -> merged_record_id
merged_record_id -> joined_authority_state
reconciled_fact_id -> contributing_origin_record_keys
generated_conflict_id -> contributing_origin_record_keys
```

Origins are grouped using the current exact stable record serialization before
model-ID disambiguation, excluding only `claim_id`/`id`. Distinct records that reuse a model ID remain distinct
and receive the existing content-derived public suffix. Identical records that
deduplicate join all origin states. Reconciliation must preserve contributor
keys for replacement/delete tombstones, active and superseded facts,
cross-collection facts, and generated conflicts. A lost, multiply attached, or
multiply mapped origin makes the authority manifest incomplete.

Duplicate semantic records use the conservative lattice:

```text
unresolved > discarded > submission relevant > non-submission
```

An `s` versus `n` disagreement is unresolved. Cross-batch identity cannot be
joined by a model-provided ID alone.

## Verification Invariants

For every model-authored record:

1. Exactly one `(kind, ordinal)` annotation exists in the same parsed batch.
2. Every model citation passes existing exact PDF.js verification before the
   record can be published. An exactly-once canonical `n` record that fails only
   an allowed publication check is discarded instead of vetoing submission.
3. Exact verification produces all raw UTF-16 occurrences of the quote on the
   verified physical page; repaired/normalized-only citations cannot authorize
   a model record.
4. Every exact occurrence is globally contained by at least one candidate from
   the complete ledger on the same document SHA and physical page.
5. `s` requires every citation occurrence to overlap at least one verified
   private relation. The server, not the model, derives those relation bindings.
6. `n` requires complete coverage for every citation occurrence and must not
   overlap any returned whole-bid, ambiguous, unknown, or unspecified-channel
   relation.
7. When a quote occurs more than once, all occurrences must yield the same
   relevance-compatible relation state; mixed or ambiguous matches fail closed.
8. `u` requires complete citation coverage and always vetoes submission
   authority; it cannot make its record authoritative.
9. A Requirement structurally categorized `submission` cannot be `n`.
10. A populated Draft summary submission method must be mirrored by at least
    one verified `s` Claim or Requirement, but Draft output never establishes
    authority by itself.
11. Missing, duplicate, unknown, relationless `s`, conflicting `s/n`, relation
    overlap/mismatch, capacity, integrity, or prompt-injection taint makes the
    record unresolved and vetoes package submission authority. Cross-document,
    non-exact, missing, or uncovered citation evidence is discardable only for
    an otherwise valid exactly-once `n` record.
12. Server-recovered deterministic records retain their existing path and are
    not required to carry model annotations. Recovery creates a new server
    identity: a recovered Claim, Requirement, Evaluation rule, or future Risk
    never inherits model authority or contributor origins merely because its
    public ID collides with a model merged-record ID.

No source-text, topic, product-name, channel-name, delivery-verb, or English
grammar dictionary participates in these decisions.

## Packing and Costs

Annotations remain attached to the extraction batch that emitted the record,
but candidate/relation matching happens globally after all responses. Coverage
candidates retain their existing exactly-once batch assignment. No candidate is
duplicated merely to follow an unknown future citation.

Provider generation and server receipts have separate bounds. The full provider
generation bound is the Responses API's requested `max_output_tokens`, not a
JSON byte estimate. Deterministic per-batch allocations sum to at most 50,000
tokens. A response must contain `output_parsed`; max-output truncation or any
incomplete response is `ANALYSIS_INCOMPLETE`, stops all later calls, and has no
retry. Reported output usage above that batch's requested cap is rejected.

Cost authority is the actual prepared plan with `N` batches. At the configured
prices, 320,000 input tokens plus 50,000 output tokens have a 465,000 micro-USD
base; the tight upper bound adds `N - 1` micro-USD because the provider rounds
each request independently. That plan-specific maximum is compared with the
495,000 micro-USD reserve before any paid dispatch. Edmonton currently observes
three batches and CER five; five is the packing target, not a global hard
maximum. Synthetic seven- and nine-batch plans remain within the reserve, while
any actual `N` whose maximum exceeds it is rejected before its first paid call.

The existing local byte calculation is explicitly a **control-plane-only**
proof for the maximum private adjudication/annotation sidecars. It is not a
bound for the complete `DraftAnalysis` response and is not converted into token
headroom. In particular, the legacy Draft schema includes an unbounded
`amendment_number`, so no finite static claim is made that every theoretical
Draft maximum fits. Edmonton (28,077 bytes) and CER (40,241 bytes) freeze useful
official control-plane measurements; complete-response usefulness remains an
empirical official/production gate enforced by the provider token cap.

The independently retained server authority receipt freezes:

```text
MAX_EXACT_OCCURRENCES_PER_CITATION = 8
MAX_RECORD_AUTHORITY_RECEIPT_BYTES = 262144
```

The v2 receipt hashes its complete canonical payload: canonical record digest,
origin-to-merged mapping, exact occurrence offsets, candidate/relation binding
digests, disposition, and contributor lineage. A ninth exact occurrence or a
receipt byte length above 262,144 produces an unresolved package veto. Nothing
is truncated and no new call or retry is attempted. Official empty-record
Edmonton and CER v2 control receipts are 166 bytes, leaving 261,978 bytes of
server-receipt headroom. Non-empty `representative_local` v2 receipts made from
real PDF.js quotes and complete official ledgers measure 3,829 bytes for
Edmonton (one verified `s` plus two `n` records across three batches; 258,315
bytes headroom) and 6,021 bytes for CER (five `n` records across five batches
and four documents; 256,123 bytes headroom). These are neither paid-output nor
worst-case claims. The first controlled post-deploy Edmonton/CER run must record
the actual non-empty receipt byte length as the empirical sufficiency gate; all
receipts are checked at runtime against the same hard cap.

That production gate is persisted as a private, sanitized
`RecordAuthorityAudit` only after cleanup confirmation, cost settlement, and the
final result transition. Its strict allowlist is exactly `version`,
`manifest_digest`, `receipt_byte_length`, `receipt_limit_bytes`, `record_count`,
`complete`, and `recorded_at`. It contains no source text, quote, page window,
URL, raw model output, record body, or full authority receipt. The digest and
byte count are copied only from a receipt whose server integrity check passes;
a missing or mutated receipt produces a fresh server-owned incomplete audit and
retains the existing fail-closed publication behavior.

The audit is not exposed by a public route. Schema v10 stores it in nullable
`runs.record_authority_audit`; new runs start with `null`. The 24-hour result
scrub deliberately retains this sanitized audit, and normal 30-day audit-row
deletion removes it with the run. An operator can retrieve one record by bound
UUID parameter with:

```text
node --env-file-if-exists=.env.local scripts/read-record-authority-audit.mjs <run-id>
```

The command emits only `run_id` plus the allowlisted fields, rejects malformed
UUIDs before database access, and exits nonzero for missing/invalid rows. The
first controlled post-deploy Edmonton/CER runs remain necessary: local tests
prove that a non-empty verified receipt's actual digest/byte length traverse the
real pipeline and store, but they are not paid-provider evidence.

## T9 Superseding Boundary — Source Ledger Owns Package Authority

T9 supersedes the T7/T8 coupling rules above where they conflict. Discovery
creates overlapping 3,200-UTF16 windows that cover every PDF.js page from byte
zero through the page end. Lexical channel matches help the Agent notice likely
relations, but neither candidate creation nor semantic channel validation is
bounded by that dictionary. Every returned relation remains exact-offset,
page-hash, batch-manifest, overlap-consistency, and confidence verified.

`VerifiedSubmissionAdjudication` is the only package-level submission-method
authority. With record authority enabled, Draft summary values, model record
channels, amendment effects, record conflicts, and record publication failures
cannot establish or remove a channel. The ledger must itself be complete and
resolve to one required whole-bid channel with an exact decisive citation.
Incomplete, multiple, contradicted, semantically uncertain, prompt-tainted, or
metadata-incomplete ledger states remain unresolved.

The server receipt is version 3. Each canonical record carries three independent
axes:

```text
source_binding = unlocated | exact_bound | coverage_gap | relation_gap | relation_conflict
semantic_crosscheck = consistent | disagrees | unknown
publication = verified | discarded
```

Unlocated `s`, `n`, `u`, missing/duplicate annotations, and later field/scalar
publication failures discard only their record. They contribute no lineage,
conflict, or Q&A evidence and cannot denial-of-service a complete unique ledger.
An exact-source `s` outside all ledger windows, without a compatible relation,
or with incompatible/ambiguous relation evidence is a real source-ledger
disagreement and vetoes publication of the method. Exact `n` overlapping a
whole-bid/ambiguous relation and exact `u` do the same. An exact `s/n`
disagreement across canonical duplicates also vetoes. Receipt corruption,
unknown annotations, lost/multiple origin mapping, merged-set mismatch, receipt
overflow, or a v1/v2 receipt suppress every model record; it does not override
an independently complete ledger.

The v3 audit retains the existing seven non-body measurements and adds only
strict fixed-key integer counters for relevance, source binding, semantic
crosscheck, publication, publication reason, and exact-source submission-veto
reason. It stores no record IDs, page numbers, offsets, URLs, source text,
quotes, windows, record bodies, or private model output. Historical v1/v2 audit
rows remain strict-readable; v1/v2 full authority receipts remain unusable for
model publication. The existing nullable JSONB column is sufficient and no SQL
or public API migration is required.

The hard receipt cap remains 262,144 bytes. Representative local v3 receipts
built from official PDF.js sources measure 4,225 bytes for Edmonton (257,919
bytes remaining) and 6,681 bytes for CER (255,463 remaining). These are local
representative measurements, not paid-provider or theoretical worst-case
claims; the runtime cap and first controlled post-QA production audit remain the
empirical authority.

## Historical T7/T8 Resolution and Materialization (Superseded by T9)

Resolution order is fixed:

```text
coverage ledger integrity
→ record-authority manifest integrity
→ document/amendment order
→ record/relation/citation consistency
→ unique channel resolution
→ exact decisive citation
```

Materialization receives the merged authority map and reconciliation contributor
lineage. It encodes every decision into existing public status/removal behavior;
Q&A never depends on the ephemeral receipt after persistence.

Record-specific publication:

| Verified record state | Result |
|---|---|
| verified `n` | ordinary Claim/Requirement/Risk/Evaluation validation may proceed |
| discarded `n` | omitted; no contributor lineage, conflict input, or Q&A authority |
| `s`, compatible with final channel | ordinary validation may proceed |
| `s`, unbound or incompatible | Claim/Requirement `needs_review`; Risk/Evaluation omitted; method null |
| `u`, structurally invalid, or missing | Claim/Requirement `needs_review`; Risk/Evaluation omitted; method null |
| server-recovered | preserve existing deterministic behavior |

Server-generated conflicts inherit the conservative join of their contributing
records. A submission-relevant or uncertain conflict remains visible for human
inspection, vetoes the method, and is not Q&A authority.

Revision 18's defensive Q&A fallback remains: when the final method is null,
only active non-submission Requirements are answerable. When non-null, Q&A may
use only records materialized as authoritative after their record-specific
receipt was applied. The receipt itself is not read after persistence. There is
no package-wide boolean that admits all free-form records.

## Required Tests

- Known Email plus unfamiliar SecureDrop Claim, Requirement, Risk, and generated
  Conflict in another page/window.
- `s` with zero relation, unspecified relation, wrong relation, wrong page, and
  another record's relation.
- `n` overlapping any whole-bid/ambiguous/unknown/unspecified relation.
- `u`, missing annotation, duplicate annotation, unknown kind/ordinal, and
  `s/n` disagreement across duplicate model records.
- Wrong record kind/ordinal, lost or multiply mapped origin, SHA, physical page,
  exact-quote offset, duplicate quote with mixed matches, batch ID, ledger
  digest, and record-manifest digest.
- Multi-citation records where any citation lacks a valid binding.
- Prompt injection in the actual packed batch invalidates every record and
  relation annotation in that batch.
- Non-submission financial/contractual records tagged `n` remain visible and
  answerable through the declared Q&A fallback.
- Deterministic cover facts, M1–M4, evaluation, security, conflicts, and
  superseded history remain unchanged.
- Official Edmonton resolves Email from p6; official CER ordering, replacement,
  conflict, and measured maximum envelopes pass.
- Call count, input/output caps, USD 0.495 reserve, aggregate deadline, replay
  fence, retry behavior, and paid settlement remain unchanged.

## Explicit Trust Boundary

The server can prove record completeness, identity, exact citation and coverage
binding, relation consistency, amendment order, and publication policy. It
cannot prove that arbitrary English was correctly labeled `n` instead of `s`.
That semantic decision belongs to the extraction Agent.

A structurally complete but consistently wrong Agent decision requires either
an independent second semantic model/human review, a deterministic semantic
classifier, or suppression of all free-form model evidence. Those are outside
T7's no-extra-call design. QA5 must test missing and inconsistent semantic
authority, not demand deterministic understanding of arbitrary English.
