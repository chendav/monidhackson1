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
