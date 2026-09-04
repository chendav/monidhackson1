# Reframing Review: MH-001 T8 — Separate Publication Validity from Submission Safety

## Status

Accepted for the smallest falsification experiment and bounded implementation.

## Trigger Evidence

The first post-T7 Edmonton production run reached `ready` with controlled cleanup,
but its core gate failed. The sanitized audit recorded 126 records, 128171 of
262144 receipt bytes, and `complete=false`; the public result reported 25 rejected
citations and withheld the independently adjudicated Email submission method.

## Underlying Problem

Record citation publishability, semantic relevance, package submission safety,
and receipt integrity are distinct. The current `complete/package_veto` pair
conflates them, so evidence already destined for omission vetoes unrelated facts.

## Invariants

- No model record is public without canonical identity and exact citations.
- Any submission-relevant, unknown, missing, duplicated, tainted, disagreed, or
  structurally unbound record keeps a package-wide submission veto.
- A canonical-bound non-submission record with invalid evidence is discarded;
  it cannot publish, gain lineage, answer Q&A, or alone veto a complete ledger.
- Recovered facts remain origin-free and exact-source gated.
- Unfamiliar channels are Agent-adjudicated, never server-dictionary classified.

## Proposed Minimum Model

Separate per-record annotation integrity, relevance (`s|n|u`), and publication
disposition (`verified|discarded|unresolved`). Separate manifest structural
completeness from submission safety; package veto derives from submission safety.

## Smallest Falsification Experiment

Use 126 synthetic records with 25 invalid canonical-bound `n` records and a
complete Email ledger. Email and recovered facts must survive; invalid records
must be omitted. Re-label one `s`/`u`, remove/duplicate an annotation, add prompt
taint, mapping mismatch, submission Requirement marked `n`, or s/n disagreement;
each must restore the package veto across every public collection.

## Migration and Rollback

Write internal authority receipt v2; dual-read v1 fail-closed. Keep the existing
private allowlisted audit and no public API migration. Roll back application code
to `885404f` while preserving schema v10 if the experiment fails.

## Chief Disposition

ACCEPT — authorize only this state-model split and tests. A later controlled paid
Edmonton run remains necessary production proof; missing closing dates stay null.

## T9 Addendum — Source Ledger Owns Package Safety

T8 production falsified the remaining coupling: 84 records, four rejected
citations, and 88865/262144 receipt bytes still produced `complete=false` and
withheld Email. The independent ledger covers every PDF.js page using complete
overlapping 3200-UTF16 windows; lexical channel matches are hints only, not the
coverage boundary.

The accepted minimum v3 model makes the complete source ledger the sole package
submission authority. An unlocated model record, including `s`, is discarded
and cannot publish or denial-of-service the ledger result. An exact-source `s`
outside ledger coverage, without a compatible relation, or with an ambiguous or
incompatible relation proves a real ledger gap/disagreement and vetoes. Exact
`n` overlap, exact `u`, ledger incompleteness/ambiguity, and prompt taint remain
vetoes. Later field/scalar/publication failure only discards the affected record.

Receipt/audit v3 adds strict bounded enum counters for relevance, source binding,
publication, publication reasons, and submission veto reasons. It persists no
text, record IDs, pages, offsets, URLs, or private output. v1/v2 materialization
remains fail-closed. No SQL or public API migration is required.

Chief disposition: ACCEPT for a bounded synthetic/official falsification matrix;
no third paid run before independent QA7 approval.

## Implemented T9 Design

The source ledger is now the only package-level submission authority. Candidate
discovery emits complete overlapping 3,200-UTF16 windows over every PDF.js page;
lexical channel matches remain hints and no longer validate or limit Agent
relations. Exact relation offsets, page/document hashes, batch manifests,
capacity, confidence, and agreement across every enclosing overlapping window
remain server-verified.

The internal authority receipt is v3. Every model record has independent
`source_binding`, `semantic_crosscheck`, and `publication` axes. Unlocated or
later-invalid records are discarded without lineage or Q&A and cannot suppress
a complete unique ledger result. Only exact-source relevance disagreement with
the ledger can set the receipt's package veto. A corrupt/mismatched/legacy
receipt suppresses all model records while leaving independently verified
ledger-derived channel authority intact.

The existing private audit JSONB now emits only fixed-key bounded counters for
the three axes, relevance, publication reasons, and exact-source veto reasons in
addition to its prior non-body measurements. Historical v1/v2 audit rows remain
strict-readable. No SQL or public route changed.

The bounded falsification matrix passes the thirteen source/relevance cases,
all four public record collections, invented and paraphrased SecureDrop, exact
coverage/relation gaps, Email plus unfamiliar-portal ambiguity, the 126/25 and
four-collection failure invariants, fourteen exact submission Requirements,
complete all-page window coverage, corrupt/v1/v2 receipts, lineage suppression,
and closed-world Q&A. Official local v3 representative receipts are 4,225 bytes
for Edmonton and 6,681 bytes for CER under the unchanged 262,144-byte cap.

## Implemented T8 Design

The provider-private annotation wire remains version 1 so T8 does not change the
paid request contract. The server-owned authority receipt is version 2. A version
1 receipt presented to the application integrity boundary is accepted as a known
legacy shape only to fail closed; it is never upgraded or allowed to publish.

Each canonical record now ends in exactly one disposition:

| Disposition | Meaning | Submission effect | Publication effect |
|---|---|---|---|
| `verified` | identity, annotation, coverage, and record evidence are valid | `s` participates in channel resolution; `n` does not veto | may proceed to field-specific materialization |
| `discarded` | exactly-one canonical `n` record failed only an allowed publication check | no package veto | omitted, no lineage, no Q&A |
| `unresolved` | semantic, structural, taint, relation, capacity, or integrity proof failed | global veto | Claim/Requirement review-only where safe; Risk/Evaluation omitted |

The only verifier reasons eligible for `discarded` are
`missing_exact_citation`, `cross_document_citation`,
`non_exact_or_uncovered_citation`, and `incomplete_occurrence_coverage`, and
only after the record has exactly one `n` annotation. All capacity failures,
exact-occurrence overflow, relation overlap/mismatch, `s` failures, `u`, missing,
duplicate or unknown annotations, prompt taint, a submission Requirement marked
`n`, `s/n` disagreement, unmirrored non-null summary, incomplete private ledger,
lost/multiple origin, merged-record mismatch, manifest-integrity failure, and
receipt overflow remain global vetoes.

Materialization applies the same boundary after the receipt. If a verified `n`
record later fails field-specific publication validation, it is omitted without
truth-blocker lineage. If a verified `s` record fails that later validation, the
package submission resolution is vetoed. This rule is collection-independent
for Claim, Requirement, Risk, and Evaluation.

`complete` now means that the receipt and all submission-safety proofs are
complete; it does not require every `n` record to be publishable.
`discarded_reasons` is separately hashed into the private receipt.
`package_veto` is true for an incomplete receipt, any unresolved record, or any
`u`; discarded records alone cannot set it.

The private audit remains the same seven-field JSONB envelope and schema v10
needs no migration. Its strict `version` accepts historical audit version 1 and
current version 2. New writes use v2; a v1 full authority receipt generates a
fresh incomplete v2 audit rather than inheriting its completeness.

The frozen falsification fixture contains 126 canonical model records and 25
bad `n` citations. It proves 25 discarded records, zero package veto, retained
Email plus recovered title/M1, null closing date, no discarded lineage, and
`not_found` Q&A. A companion four-collection fixture and explicit counterexample
matrix cover every global-veto condition above.

## T10 Addendum — Three Independent Delivery Contracts

The T9 production run falsified the assumption that record-receipt diagnostics
could explain package submission resolution. Its 114-record v3 receipt was
globally incomplete and the audit attributed every discarded record to
`receipt_integrity`, while all submission-veto counters were zero. Static
tracing proves that this receipt state cannot itself null Email. The independent
source-ledger adjudication was also incomplete or unresolved, but v3 persisted
neither subsystem's initiating bounded reason.

The accepted minimum model has three non-substitutable contracts:

1. `ExtractionDelivery` proves that each provider response parsed under its
   exact batch schema and cost/deadline commitment.
2. `RecordPublicationAuthority` binds relevance directly to each emitted
   private record and controls only that record's publication and lineage.
3. `SourceLedgerAdjudication` owns complete all-page candidate coverage,
   relation consistency, unique channel resolution, and decisive citation.

Provider-private submission wire v2 uses a schema generated from each actual
batch. The server-signed batch and ledger digests are literals. Every candidate
is a required strict object key whose value is its bounded relation array; the
server supplies immutable document/page/candidate metadata rather than asking
the model to echo it. Missing, duplicate, or unknown candidates therefore fail
schema parsing. Existing offset, confidence, overlap, prompt-taint, and
unfamiliar-channel fail-closed checks remain authoritative. If strict dynamic
object schemas fail the local formatter or budget experiment, the hypothesis is
rejected rather than weakened silently.

Record relevance moves inline into every private Claim, Requirement, Risk, and
Evaluation record. It is required by Structured Outputs and stripped before
the public Draft is built. This removes positional sidecar loss and the
arbitrary 40-tuple delivery boundary without adding a vocabulary heuristic.
Receipt v3 may remain the record-publication representation if it can faithfully
seal the inline classifications.

A separate versioned, operator-only submission audit persists only fixed enums,
counts, booleans, and bounded per-batch status. It records expected/verified
candidate, fragment, page, and batch counts, resolution status, and every fixed
unresolved-reason count. It stores no source text, quote, candidate ID, page
number, offset, URL, model output, or raw run identifier. Historical absence is
`not_recorded`, never inferred success.

The smallest no-cost falsification experiment covers: complete Edmonton fixture
to unique Email; missing/extra candidate keys and wrong literal digests failing
schema parse; semantic offset/confidence/overlap failures reaching their exact
audit counters; unfamiliar SecureDrop remaining unresolved; corrupt record
authority with complete Email still publishing Email; complete records with
incomplete ledger withholding Email; redaction allowlists; provider call count,
token preflight, reservation, and deadline bounds remaining unchanged.

Chief disposition: ACCEPT. No deployment or paid run is authorized before this
experiment passes and independent QA8 returns `PASS` with P0=0 and P1=0. The
migration is private-contract and nullable-audit only; rollback is the prior app
commit plus retention of any additive nullable database field.

## T11 Addendum — Make rejected relations unrepresentable

The controlled T10 production run closed the delivery diagnosis: 81 expected
minus 63 verified candidates equals exactly 15 `quote_too_long` plus 3
`low_confidence` rejections. All 55 pages and 16 fragments were covered and the
dynamic batch schema was accepted. The minimum correction is therefore the
provider-private representation, not another authority ontology.

Chief disposition: ACCEPT provider wire v3 with descriptive record relevance,
`start_utf16 + length_utf16` where length is structurally bounded to 1..500, and
an explicit uncertainty outlet while decisive confidence is structurally at
least 0.9. Server checked-add, window, occurrence, condition, overlap, taint, and
unfamiliar-channel verification remain mandatory. Old private wire v2 is not
accepted because raw provider output is not persisted.

The production audit's four `missing` relevances are not missing strict fields:
the required inline schema and decoder make that impossible after a successful
parse. They are canonical merges with disagreeing classifications and must be
reported as unresolved merge disagreement. Receipt integrity and package veto
must also remain separately observable.

Selection recovery is an independent publication issue. Once a server-recovered
evaluation field is source-verified, model rules for that same document and
field cannot overwrite it or cause a submission-relevance veto to clear it.
Contrary-value, same-value/different-ID, and no-recovery controls must falsify
that precedence rule.

No deployment or paid run is authorized until the bounded local experiment and
full regression gates pass and independent QA9 returns `PASS` with P0=0/P1=0.

## T12 Addendum — Context is not authority

The controlled T11 production run proved the prior structural correction:
`quote_too_long=0` and `low_confidence=0`, and server-recovered selection stayed
active. It also falsified the assumption that overlapping context windows can
serve as independent authority units: the remaining 21 candidate failures were
one offset mismatch, fourteen semantic uncertainties, and six cross-window
overlap disagreements, with all 55 pages and 16 source fragments covered.

Chief disposition: ACCEPT a canonical-core redesign; REJECT overlap voting,
choosing a preferred window, weakening uncertainty, or adding a channel
lexicon. Every page is partitioned into mutually exclusive half-open owned
cores. Each core receives bounded left/right halo only for interpretation, and
a relation belongs to exactly one core by a deterministic midpoint rule. The
provider-private wire must explicitly mark each core's coverage complete or
uncertain; uncertainty remains fail-closed. Ledger and wire versions must bump
because ownership is part of candidate identity.

The smallest experiment proves gapless one-owner page coverage, a unique owner
for a 500-unit relation at each boundary, rejection of non-owner relations,
relative/absolute offset safety, clear Email and unfamiliar SecureDrop cases,
and empty administrative cores. The T11 run also contained two mixed canonical
record relevances, but the redacted audit cannot prove whether they represent
disjoint source occurrences. Chief therefore rejects relaxing that veto in T12;
mixed remains fail-closed until a separately reviewed physical-occurrence model
can falsify the unsafe counterexample.

No deployment or paid run is authorized until this experiment, the full local
gate, and independent QA10 pass with P0=0/P1=0.

## T13 Addendum — Coverage has a domain, conditions have one coordinate system

The controlled T12 run proved canonical ownership: offset, overlap, ownership,
length, and confidence failures were all zero. It falsified the remaining
provider wording and condition representation with fifteen
`semantic_uncertainty` outcomes and one `condition_mismatch`.

Chief disposition: ACCEPT a delivery-domain coverage definition and a single
relation-relative condition object. REJECT weakening uncertainty, ignoring
relation gaps, relaxing mixed-record vetoes, restoring overlapping authority,
or adding a channel dictionary.

`coverage=complete` means the Agent exhaustively scanned the owned core for
every semantic predicate linking any artifact, whole bid, question, or other
subject to transmission, lodging, delivery, or receipt. Named and unfamiliar
mechanisms remain in scope. `complete` with an empty relation list is valid when
the core contains no plausible delivery relation; it says nothing about whether
unrelated procurement prose was fully understood. `coverage=uncertain` is
reserved for a plausible target relation that cannot be safely bounded or
classified, truncated context, or capacity failure.

The private wire replaces independent context-relative condition offsets with
one nullable object containing `start_in_relation_utf16` and `length_utf16`.
The server uses checked addition and requires the condition span to fit wholly
inside the already verified relation span. Old private wire shapes fail closed.

The no-cost falsification matrix includes administrative and unrelated ambiguous
cores returning complete-empty; Email and question relations remaining distinct;
unknown SecureDrop whole-bid delivery remaining source-bound generic electronic;
plausible unclassifiable delivery remaining uncertain; null, malformed, zero,
oversized, and out-of-relation conditions; boundary ownership; mixed relevance;
exact relation gaps; provider call, retry, deadline, and cost ceilings; official
Edmonton/CER fixtures; full check, build, and browser tests.

No deployment or paid run is authorized until independent QA11 returns PASS
with P0=0 and P1=0.

## T14 Addendum — Bind the contract, not live telemetry

The first CER production attempt failed before paid dispatch because the
application hashes the entire credentialed Monid inspect response. A non-paid
reinspection confirmed that the response mixes stable parse identity, strict
request schema, and price terms with live latency telemetry and descriptive
catalog metadata. The whole-response hash is therefore not a usable contract.

Chief disposition: ACCEPT one shared, versioned semantic projection used by
both runtime and release attestation; REJECT blind hash refreshes, heuristic
field-name stripping, or weakening paid-dispatch validation. The projection
binds exact `context.dev /parse POST` identity, every validation-bearing request
schema keyword, strict property set, and exact tiered USD price structure. Only
an explicit allowlist of known telemetry and presentation fields is excluded;
unknown schema or pricing semantics fail closed.

Configured result, lifecycle, provider-status, cost paths, artifact hosts, and
runtime types remain a separately labeled adapter contract. ZDR unavailable,
observed seven-day expiry, and absence of early delete remain historically
observed evidence rather than claims derived from inspect. Terminal responses
continue to be validated on every paid run.

The same semantic contract hash stays in the existing environment, attestation,
and cost-provenance fields to avoid an API or database migration. Tests must
prove telemetry-only changes keep the hash stable while identity, required
properties, types, formats, enums, bounds, strictness, tier selector, amount,
currency, charge unit, configured paths, or artifact hosts block dispatch.

The provider describes a 25 MB input ceiling without a byte-valued schema
limit. The existing 25 MiB application limit must not be described as
provider-verified; T14 should conservatively use 25,000,000 bytes if that value
is enforced in the same bounded change, otherwise retain the existing limit
with an explicit unverified-unit risk and do not expand the claim.

No second CER attempt is authorized until T14 passes focused tests and
independent QA12 with P0=0/P1=0, then the exact deployment is re-attested.

## T15 Addendum — Output capacity is a package balance, not equal batch property

The controlled CER run falsified equal-share allocation. All four Monid parses
and cleanup succeeded, but the first of five OpenAI batches exhausted its fixed
10,000-token share and returned `incomplete_max_output`; no later batch was
attempted. GPT-5.4 Mini already defaults to reasoning effort `none`, and the
Responses API counts visible plus reasoning tokens together, so a reasoning
toggle or a second attempt is not a capacity model.

The stable invariants are: at most 50,000 aggregate output tokens, at most the
USD 0.495 OpenAI reserve, one attempt per planned batch, complete structured
output or fail closed, and the existing per-request context/deadline limits.
The equal `1/N` shares are accidental. The run proves that CER batch 1 needs
more than 10,000 combined output tokens; it does not prove its exact need or
that all five complete responses fit within 50,000.

The minimum canonical state is a sequential package output balance. For each
batch `i`, compute a protected floor `F[i]` before any paid dispatch from the
UTF-8 byte length of a canonical minimum valid Draft envelope plus that batch's
existing maximum private control-plane envelope. This ASCII-heavy byte count is
a conservative token floor and is bound to the exact dynamic schema. Reject the
plan before paid work if `sum(F) > 50,000`.

The saved CER plan rules out replacing equality with a simple proportional
weight. Its `(input bytes / source UTF-16 / candidates / control bytes)` rows
are `115259/49990/23/6014`, `115153/49995/22/5942`,
`115846/49978/24/5931`, `117020/40546/27/7423`, and
`80358/25029/20/9131`. Failed batch 1 is not the maximum on input bytes,
candidate count, or private control size, and is effectively tied with batches
2 and 3 on source length. None of those individual implementation metrics is
canonical output demand.

Reserving only the four later control-plane byte bounds would give batch 1 an
exact cap of `50,000 - (5,942 + 5,931 + 7,423 + 9,131) = 21,573`. This is a
useful counterexample to 10,000 equal sharing, but it is not by itself a
truthful future floor because the control-plane measurement explicitly omits
the mandatory `analysis` JSON. The experiment must add the exact fixed minimum
Draft/envelope overhead for each dynamic schema and still prove the first cap
exceeds 10,000; otherwise the proposed floor is falsified.

Let `A` be output already accounted: use provider-reported combined output
tokens after a valid response, or the entire requested cap when usage is
missing or invalid. Immediately before batch `i`, set:

```text
remaining = 50,000 - A
cap[i] = remaining - sum(F[j] for every unattempted j > i)
```

Thus every later batch retains its structural floor, while all discretionary
capacity is available to the next sequential batch. A successful response uses
only its reported tokens, so unused capacity remains in the package balance and
can serve either an early or late dense batch. An incomplete response still
fails immediately without retry. This replaces the static cap vector, the
special case for stranded early capacity, and a separate late-batch lending
rule with one conservation invariant:

```text
accounted past + current requested cap + protected future floors <= 50,000
```

The smallest reversible experiment replays the saved, hash-bound CER plan
without provider calls. It must derive five floors from the exact v5 schemas,
prove their sum is at most 50,000, and produce a first cap greater than 10,000.
A fake client then runs early-skew (`>10,000` first, small later), late-skew
(small first, `>10,000` last), symmetric, exact-50,001 aggregate demand,
missing/invalid usage, and first-batch `incomplete_max_output` cases. The model
is falsified if either skewed case with aggregate demand at most 50,000
truncates solely because capacity was stranded, any request violates a future
floor or the conservation equation, invalid usage lends capacity, aggregate
accounting exceeds 50,000, or provider call/retry count changes.

Cost remains bounded independently: output pricing still reserves exactly
50,000 tokens, and the existing input maximum contributes at most 320,000
tokens. At current rates that is 225,000 plus 240,000 micro-USD, plus the
existing actual-batch rounding allowance, below 495,000 for the five-batch CER
plan. The current conservative check `batch input + 50,000 <= context` remains
unchanged, which is also below the documented 128,000 model output maximum.
Deadlines, batch order, schemas, extraction semantics, and zero-retry behavior
do not change.

Confirmed: equal sharing caused the observed first-batch ceiling; only one
OpenAI batch was attempted; the estimated failed-attempt maximum was 69,645
micro-USD; and CER's existing private control-plane bounds total 34,441 bytes.
Inferred: a work-conserving protected-floor balance is more likely to complete
CER because it makes the currently stranded discretionary capacity available
without increasing any envelope. Unknown: the exact complete-output demand of
batch 1 and the package total, because the incomplete private response was
correctly not retained.

Migration is confined to output-cap planning and its focused tests. Rollback is
the prior static allocator; no stored data, public API, schema, provider model,
or canonical analysis state changes. Chief disposition: **ACCEPT** the bounded
saved-fixture experiment and, only if it passes independent QA13 with P0=0 and
P1=0, authorize the ordinary implementation/release workflow. Do not authorize
another paid CER run from this review alone.

## T16 Addendum — A citation selects a source span; it does not author evidence

The completed CER extraction exposed a source-representation mismatch rather
than a record-authority capacity failure. The model received Monid Markdown and
authored `evidence_quote` strings from that representation, while
`exactOccurrences` discarded the Markdown provenance and searched only for the
literal string in PDF.js physical-page text. Of 190 model records, 127 were
therefore `source_unlocated`; only 32 records survived publication.

The invariants are unchanged: Monid remains the semantic normalization input;
PDF.js raw page text, document SHA, physical page, and exact raw slice remain
the only citation authority; every citation binds to exactly one document/page
span; paraphrase, zero matches, multiple matches, cross-page spans, and
wrong-document selectors fail closed; provider calls, token/cost envelopes,
deadlines, and retries do not increase.

The current accidental ontology treats a model-written quote as both semantic
selection and physical evidence. The minimum replacement separates them:

1. A private `SemanticSpan` is a model selection of an existing server-issued
   Monid `source_fragment_id`, UTF-16 start, and length. The model no longer
   supplies authoritative evidence text or a page number.
2. Before extraction, a server-owned `DocumentSourceMap` binds the exact Monid
   representation hash and fragment coordinates to zero or one exact,
   contiguous PDF.js span: document SHA, page-text hash, physical page, raw
   UTF-16 start/end, exact slice hash, and alignment version.
3. Decoding accepts a selector only when its complete substantive token range
   has one monotonic, contiguous, single-page mapping. It then constructs the
   public `evidence_quote` from the exact PDF.js slice and carries the private
   physical binding into record authority. Authority verifies that binding and
   slice directly instead of rediscovering location by searching quote text.

The source map is provenance-preserving alignment, not tolerant citation
matching. Its tokenizer may normalize only enumerated representation artifacts
such as line-ending/whitespace runs, Markdown table delimiters, and reversible
Unicode compatibility glyphs while retaining every raw offset. It must not use
case folding, stemming, synonym substitution, edit distance, punctuation-wide
deletion, or semantic similarity. Every non-layout token selected from Monid
must equal the mapped PDF.js token under that versioned transform. Ambiguous
alignments remain zero authority; surrounding context may prove uniqueness but
is never included as cited evidence unless the model selected it.

This model rejects three broader alternatives. Normalized or fuzzy searching
of a free quote remains many-to-one, loses its Monid origin coordinate, and can
bind repeated text, deleted negation, reordered table cells, or a paraphrase to
the wrong page. PDF.js-only model input would make copying easier but discards
the already demonstrated value of Monid table/semantic normalization and
changes extraction quality rather than repairing provenance. Sending both full
Monid and PDF.js bodies makes two competing evidence sources model-visible,
expands the already bounded inputs, and still lets the model cite the wrong
representation. A private source map retains one semantic body in the prompt
and keeps the second representation solely in deterministic server authority.

The model-visible fragment IDs already exist. Replacing each private citation's
free `evidence_quote` with a fragment selector therefore requires no second
provider request and need not add source text. The server-side map is temporary;
only the existing exact public quote/binding receipt and bounded hashes need
survive cleanup. Any dynamic-schema/token change is measured by the existing
preflight and T15 package balance; the 320,000 input-token, 50,000 output-token,
USD 0.495 reserve, model context, one-attempt, and zero-retry gates remain exact.

The minimum no-provider falsification gate uses synthetic representation pairs
plus locally indexed, hash-bound official CER PDFs. The production Monid body
and raw private model output were correctly purged and are not available for
offline replay; therefore no claim may be made that all 127 production rejects
are recovered before one later reviewed production proof:

- line wrapping, repeated whitespace, Markdown table delimiters, soft hyphens,
  and an allowlisted Unicode ligature must resolve to one exact raw PDF.js slice;
- the returned public quote must be byte-for-byte that slice, never the Monid
  spelling, and its private document/page/start/end hashes must reverify;
- repeated identical text on two pages, two possible monotonic alignments,
  cross-page selections, wrong document IDs, out-of-range fragment offsets,
  unmatched substantive tokens, reordered values, deleted `not`, and
  paraphrases must remain unbound;
- two identical quotes selected at different fragment offsets must retain their
  distinct physical bindings rather than be re-searched globally;
- page-core ownership and submission relation cross-checks must use the bound
  physical midpoint, preserving the unfamiliar SecureDrop counterexample;
- a fake structured response spanning Claim, Requirement, Risk, and Evaluation
  must decode selectors, replace quotes, and pass the unchanged record receipt,
  while one mutated selector discards only its affected record or restores the
  existing package veto when submission-relevant;
- the local CER gate must prove declared golden physical-page evidence remains
  uniquely bindable and record only counts/hashes, without persisting source
  bodies; it cannot simulate the purged Monid representation;
- serialized bytes/tokens, T15 protected floors, aggregate cost, call count,
  retry count, and deadline assertions must be unchanged or lower.

The hypothesis is falsified if required CER golden evidence cannot be uniquely
aligned without fuzzy rules, if a paraphrase or ambiguous repeated span gains
authority, if the public quote differs from the bound PDF.js slice, if a model
page number influences binding, or if the private selector/map pushes any
existing provider budget over its cap. The production audit alone cannot prove
that all 127 rejected records are recoverable because raw private responses
were correctly not retained.

Migration is private and reversible: version the citation selector/source-map
contract, dual-read the old free-quote wire only to fail closed, and leave the
public Draft, database, provider count, and physical citation receipt format
unchanged where possible. Rollback restores the old decoder and continues to
discard unlocated Markdown quotes; no data migration is required. Chief
disposition: **ACCEPT** only the saved-artifact alignment experiment and
independent QA14 gate. No provider rerun is authorized by this review.

## T17 Addendum — Prove the selected span, not its 10k container

The controlled T16 production proof falsified the source map's alignment unit,
not the private selector ontology. All provider work and cleanup completed and
the response contained valid fragment selectors, but all 194 model records were
`source_unlocated`. Static inspection shows why: `buildDocumentSourceMap` first
requires the complete Monid fragment to occur exactly once in the concatenated
PDF.js document units, and `resolveSemanticSpan` rejects every selector when
that whole-fragment `match_starts` count is not one. One unrelated heading,
table-layout, page-boundary, or other representation difference anywhere in a
roughly 10k fragment therefore revokes every otherwise exact selected span.

Chief disposition: **ACCEPT** a selector-scoped saved-fixture experiment and
independent QA15; **REJECT** broader normalization, fuzzy matching, or another
provider run before that gate. Production proves that whole-fragment alignment
has effectively zero CER coverage. It does not prove how many of the 194
purged private selections a selector-scoped resolver will recover.

The canonical authority unit remains the authenticated tuple
`(source_fragment_id, source_representation_sha256, start_utf16, length_utf16)`.
The minimum source-map change is to stop storing a whole-fragment physical
origin as a prerequisite. For each selector, the server must instead:

1. Require the fragment ID to be in that batch's exact dynamic enum, recover
   the exact server-issued fragment and representation hash, check UTF-16
   bounds, and slice only the selected source range. Full authenticated fragment
   text may still be tokenized to decide whether a selected `|` belongs to a
   structurally valid Markdown table; it is not required to align as a body.
2. Transform selected units only with the QA14 allowlist: whitespace runs,
   explicitly listed presentation glyphs, removable zero-width/soft-hyphen
   artifacts, and delimiters proven by the complete Markdown table grammar.
   There is no unrestricted NFKC, case fold, edit distance, stemming, synonym,
   loose pipe stripping, punctuation-wide deletion, or reordering.
3. Search each physical PDF.js page of the selector's exact document
   independently. A candidate exists only when every substantive selected unit
   maps monotonically to consecutive normalized page units. Construct its raw
   bounds from the first and last mapped units and return only the exact,
   contiguous PDF.js page slice, still at most 500 UTF-16 code units. Searching
   page by page makes a cross-page candidate impossible.
4. Bind only one surviving physical candidate across the document. Zero or
   multiple candidates remain `source_unlocated`. Record authority must rerun
   this same resolver from the exact ephemeral source map and require complete
   binding equality, preserving QA14's mutation fence.

Authenticated source-side context may safely disambiguate repeated selected
text, but only as an eliminative uniqueness witness. When the selected units
have multiple exact physical candidates, the server may take a fixed bounded
number of immediately preceding and following units from the same authenticated
fragment and test them, under the same narrow transform, immediately adjacent
to each candidate on that same page. Context can remove candidates; it cannot
create a selected-span candidate, alter its raw bounds, cross a page, widen the
public quote, repair an unmatched selected unit, or win by a similarity score.
At least one non-empty contextual side must participate and exactly one
candidate must remain; otherwise resolution fails closed. Thus a repeated
`Submit electronically` can be distinguished by an exact adjacent section or
row label, while repeated or representation-incompatible context remains
ambiguous. The public citation is still only the model-selected exact PDF.js
slice; contextual units are neither evidence nor persisted body content.

This does not require a provider representation change. Citation wire v6
already supplies the fragment ID and UTF-16 range, and the dynamic literal
manifest already authenticates its namespace. Bump only the private alignment
semantic version so old bindings fail closed; keep the public Draft, database,
record receipt shape, provider input/output envelopes, 50,000-token package
balance, USD 0.495 OpenAI reserve, one attempt per batch, deadlines, and zero
retry invariant unchanged. Pre-index normalized PDF.js units per page and cache
resolution by selector tuple. Existing record/citation maxima bound work; an
implementation resource-limit breach fails the batch without a retry or a
partial authoritative binding.

The smallest no-provider falsification fixture needs no saved Monid output. It
constructs a server-authenticated synthetic fragment containing an exact CER
golden clause, places a harmless non-aligning heading/table/layout mutation
outside the selected coordinates, and feeds a fake strict response selecting
only that clause. The old whole-fragment resolver returns null; the proposed
resolver must return the unique byte-for-byte PDF.js page slice. This proves the
scope property without reconstructing or retaining a production body. A second
synthetic pair repeats the selected clause on two pages: unique authenticated
adjacent context must reduce it to the correct single page, while identical,
missing, non-adjacent, cross-page, or mutated context must leave it unbound.

QA15 must additionally falsify: a selected superscript `10²` against `102`; a
non-table `A || B` against `A B`; deleted `not`; reordered values; paraphrase;
wrong document or fragment ID; changed representation hash or selector
coordinate; a split surrogate; zero/over-500 length; ambiguous same-page and
cross-page repeats; and any authority re-resolution mismatch. Positive controls
must cover whitespace, line endings, the reviewed ligature map, complete
Markdown tables whose grammar is classified using the enclosing fragment, all
four record collections, distinct identical selections, physical midpoint/core
ownership, and unfamiliar SecureDrop. Public quotes must equal exact PDF.js
slices, and call count, retries, schemas, T15 floors, cost reserve, and deadlines
must be unchanged.

The hypothesis is falsified if an unrelated fragment difference still revokes
an otherwise unique selected span, if contextual evidence causes a selected
text mismatch to bind, if any ambiguity is resolved by ranking rather than a
single exact contextual witness, if a public quote includes unselected context
or differs from its raw page slice, or if authoritative re-resolution accepts a
changed source tuple. Without the purged Monid body/private response, local
tests cannot establish the production recovery rate; only a later reviewed
controlled proof may do that.

Migration is private and reversible. Replace whole-fragment `match_starts` with
selector-scoped resolution while retaining authenticated fragment text and
page indexes ephemerally, bump the alignment literal, and reject prior literals.
No stored-body or public-data migration is needed. Rollback restores the T16
whole-fragment resolver and safely returns to discarding these records; it must
not fall back to free-quote search or tolerant matching. No deployment or paid
run is authorized until QA15 passes with P0=0 and P1=0.

## Release-validation addendum — Reviewed regression; sample production once

Status: **ACCEPTED AS REFRAMED BY CHIEF AFTER QA16**. This section
supersedes the earlier proposal to retain provider-shaped intermediates. No
such intermediate artifact is required or claimed by T18.

### Evidence classes

The release gate separates three facts that have different evidence units:

1. `deterministic_regression=10/10`: ten reviewed repository test selections,
   executed in separate provider-free child processes with exact structured
   identities and counts;
2. `live_edmonton=1/1`: one accepted signed-PUT Edmonton production run; and
3. `live_cer=1/1`: one accepted shuffled four-document CER production run.

The first class is regression evidence only. It does not show provider
acceptance, provider determinism, production Workflow behavior, live source
cleanup, wallet movement, cost, Q&A, Turnstile, signed ingress, or reviewer
citation clicks. Those facts remain attached only to their live or independent
review evidence.

### Reviewed repository regression manifest

The repository owns exactly ten named Vitest cases. Every case has a fixed test
file, fixed `-t` selection, fixed arguments, expected executed/pass count, and
expected SHA-256 of the sorted full test identities. Each case runs in a new
Node process with `shell:false`, a credential-stripped environment, a bounded
timeout/output, and the Vitest JSON reporter.

A case passes only if its structured report has the exact reviewed identity and
count, every selected test passed, and failed, pending/skipped, todo, and
pending-suite counts are all zero. Exit zero alone is never evidence: zero
matches, a renamed selection, a skipped suite, count drift, malformed JSON, or
an incomplete report fails closed.

The manifest binds candidate HEAD; runner, test, Vitest configuration,
`package.json`, lockfile, and official-manifest hashes; exact Node and Vitest
versions; fixed case manifest; per-case structured summaries; and the saved
official PDF set. Tracked or untracked changes to product, test, script,
configuration, dependency, or official-manifest inputs invalidate the run.
These inputs are rechecked after every child and before the atomic body-free
receipt is written below ignored `.data/`.

The official-PDF case requires the saved Edmonton file and all four saved CER
files. Every byte length and SHA-256 must equal the official manifest; a missing
file cannot become a skipped test. The remaining cases exercise the frozen
Edmonton/CER facts, shuffled amendment behavior, idempotency/admission resume,
cleanup failure and delayed completion, source-binding and unfamiliar-channel
safety, structured-output incompleteness/usage accounting, and budget
mutation. Passing this manifest means only that the reviewed repository
regressions passed on the named candidate.

### Point-in-time live proofs

After the exact candidate is committed, deployed, freshly attested, healthy,
and within the existing daily/per-run reserve, run exactly:

- one Edmonton production analysis through signed PUT, requiring CORS and
  one-time replay fencing, READY, app-controlled cleanup, Edmonton golden
  facts, independently matched physical-page citations, grounded Q&A, complete
  cost accounting, and its observed end-to-end and Q&A latency; and
- one CER production analysis in deliberately shuffled base/amendment order,
  requiring READY, complete provider responses, cleanup, correct version chain
  and M3 replacement, the cited 2050/2055 conflict, grounded Q&A, complete cost
  accounting, and its observed latency.

The wallet delta is reconciled against these live attempts. A failure returns
to sanitized audit evidence and the smallest local falsifier; it is not retried
to select a nicer result. The two latency values are observations, not a
distribution.

### Non-substitutable publication gates

Repository regression evidence can never satisfy exact-deployment runtime and
provider attestations, public health and Turnstile mutation, signed ingress,
provider response acceptance, production Workflow/API orchestration,
application cleanup, wallet/provider-cost reconciliation, upstream-retention
disclosure, the production recovery canary, the independent 12-citation
review, the full release-candidate gate, or final Reviewer approval. It also
cannot support a median, P95, provider stability rate, or cleanup reliability
rate.

The former ten-Edmonton-plus-one-CER paid campaign remains available only as an
explicit benchmark. Any percentiles from that optional campaign must be
labelled benchmark measurements and are not a default publication condition.

### Falsification and rollback

The split fails closed if any named test is absent, skipped, todo, failed,
renamed, or count-drifted; a semantic input or dependency changes; an official
PDF is absent or hash-mismatched; repository regression evidence is used to
fill a live-only field; either live package fails on the reviewed deployment;
or release copy turns a single observation into a statistical claim.

Rollback may restore the stricter paid benchmark, but never permits skipping
live cleanup/cost/Q&A, exact-deployment evidence, citation review, or
independent QA.
# T23 local captured-response experiment — 2026-09-04

This section supersedes earlier materialization hypotheses for the current
diagnostic decision, without claiming the original product objective complete.

Trigger: T20 and T21 both passed local synthetic gates yet live CER published
zero facts. Latest retained proof has 74 authority-verified records and 131
exact citation receipts, but all 195 model records were removed. No retained
draft can identify which later gate removed them. Cleanup alias and draft
post-verification mutation were inspected and are unsupported hypotheses.

Underlying problem: the validation pipeline's intermediate decisions are not
observable or reproducible after an actual provider response is discarded.
The next change must establish a reproducer before selecting another fix.

Invariants: exact official source SHA and physical pages, preserved numbers and
polarity, typed-role correctness, literal public citations, real costs, no
provider retries or production body retention changes.

Minimum experiment: one local saved-PDF excerpt, one actual model batch capped
at USD 0.25, cache the exact structured response under ignored `.data`, and
replay it through the real adapter with zero-network transport to reconstruct
authority and its process-local projection sidecar. Passively instrument actual
gates; do not copy their logic. Record where each decoded record is dropped.

Independent experiment review requires the above sidecar reconstruction,
body-free gate traces, source/config/schema hashes, one-shot cost guard and
at least one Requirement plus typed Evaluation. Without those records the
outcome is INCONCLUSIVE. A one-document experiment cannot prove amendment
reconciliation; omitting Monid cannot prove production Markdown alignment.

Chief disposition: ACCEPT the revised bounded experiment specification;
implementation must be inspected before the single paid local capture. No
production refactor is accepted until captured evidence identifies the cause.

## T23 evidence and T24 disposition

Real capture completed in 13.87s with 3,787 input and 1,985 output tokens.
The model emitted `Canada` but its selector resolved to `th the`; the correct
solicitation number resolved to a missing-prefix slice. This confirms offset
calculation is an inappropriate model-owned responsibility. The incomplete
excerpt ledger stopped all records before later materialization gates, so the
experiment does not establish complete CER causality.

Reviewer independently ACCEPTED a bounded citation migration: model emits issued
fragment ID, exact bounded quote and section; server uniquely matches raw UTF-16
text and computes the selector. Existing physical, semantic, numeric, polarity,
authority and reconciliation gates remain. No normalization/fuzzy repairs and
no submission relation-offset changes. Chief disposition: ACCEPT T24 for this
proven defect only. Cached wrong-offset response remains local replay evidence.

### T24 captured quote-fidelity delta

The single reviewed v7 capture (3,829 input / 2,063 output tokens) returned nine
raw-exact quotes and two selection-method quotes differing only by the position
of a line break. Cached zero-network measurement found all eleven uniquely
whitespace-equivalent in their issued source. Independent Reviewer ACCEPTED
matching through nonempty whitespace-run equivalence, with a raw-offset map,
all non-whitespace UTF-16 units unchanged, uniqueness across the full equivalence
domain even when a raw-exact candidate exists, and the existing raw 500-unit and
physical-verification gates. This supersedes only T24's whitespace-exact rule.
Chief ACCEPT: bounded representation delta, no further paid call. Full-package
publication remains unproven because excerpt coverage is deliberately incomplete.
