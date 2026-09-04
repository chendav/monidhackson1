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
