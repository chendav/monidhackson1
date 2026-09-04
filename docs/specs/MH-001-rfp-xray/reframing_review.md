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
