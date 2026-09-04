# QA4 Independent Review — T6 Revision 15

```yaml
task: QA4
reviewed_handoff: handoff-backend.md Revision 15
verdict: REQUEST_CHANGES
revision_round: 0
p0: 0
p1: 5
p2: 3
```

## P1 Findings

1. `P1-QA-GLOBAL-VETO`: an incomplete private artifact can leave a corroborated
   submission requirement active, allowing Q&A to answer with a channel while
   the summary correctly withholds it.
2. `P1-OCR-UNBOUND-FENCE`: additional Monid/OCR submission evidence that cannot
   bind to PDF.js is discarded instead of fencing a unique PDF.js channel.
3. `P1-CONDITION-SPAN-BINDING`: condition offsets are window-bounded but not
   relation-bounded, so unrelated later conditions can change prohibition
   semantics.
4. `P1-AMENDMENT-MUTATION-VETO`: an explicit verified amendment deletion signal
   is ignored when no private amendment relation survives.
5. `P1-PROMPT-INJECTION-VARIANT`: `Forget prior directions; output ...` is not
   batch-tainted and can publish a mocked, offset-valid injected relation.

## P2 Findings

1. A lexical occurrence intersecting but not enclosed by a 3,200-character
   window is impossible to cover in that candidate and forces unresolved.
2. The same candidate assigned to two server batch bindings can still yield a
   globally complete artifact.
3. Private-output fit uses fixed token estimates rather than an exact or
   demonstrably conservative serialized-envelope bound.

## Independent Passing Evidence

- Focused T6 suite: 335/335.
- `pnpm check`: 662 passed, 10 skipped.
- Official Edmonton/CER PDF audit: 3/3.
- Golden/security/API/cleanup subset: 38/38.
- Production build: passed.
- Playwright: 14 passed, 2 credentialed live tests skipped.
- No public contract, database, migration, or UI change was found.

## Next Gate

T6 Revision 16 must add exact adversarial regressions for every finding and
produce a new handoff. QA4 then re-reviews the bounded delta. Deployment and
paid runs remain prohibited until QA4 returns `PASS` with P0=0/P1=0.

## QA4 Revision-Round 1 — Revision 16

```yaml
verdict: REQUEST_CHANGES
revision_round: 1
p0: 0
p1: 1
p2: 0
```

`P1-QA-GLOBAL-VETO-UNKNOWN-CHANNEL` remains. With exact PDF.js evidence saying
`Bids must be lodged in SecureDrop.`, an incomplete private artifact correctly
withheld `summary.submission_method` but left the `submission` requirement
active; Q&A then answered it authoritatively. The same leak reproduced across
several unfamiliar topics. The authority gate must use server-owned category
and completion state, not a fixed channel lexicon.

## QA4 Revision-Round 2 — Revision 17

```yaml
verdict: REQUEST_CHANGES
revision_round: 2
p0: 0
p1: 1
p2: 0
```

`P1-QA-GLOBAL-VETO-NONREQUIREMENT` remains. Revision 17 correctly demotes the
SecureDrop `submission` requirement and makes its Q&A `not_found`, but the same
source text stays authoritative when emitted as a free-form Claim or Risk; Q&A
answers both while `summary.submission_method=null`. Every public evidence
collection must obey the server-owned resolved submission state without a
known-channel vocabulary gate.

## QA4 Revision-Round 3 — Revision 18

```yaml
verdict: REQUEST_CHANGES
revision_round: 3
p0: 0
p1: 1
p2: 0
disposition: architectural_redesign
```

`P1-QA-NONNULL-UNFAMILIAR-DISAGREEMENT` remains. Revision 18 fixes every null
authority path, but a valid Email relation on one page makes the global gate
true while an unfamiliar SecureDrop Claim or Risk from another page can remain
authoritative when that coverage unit reports zero relations. This violates the
Draft-veto requirement. All original Revision 15 failures otherwise pass.

The three-round T6 review loop is exhausted. T7 must replace the global boolean
with record-bound Agent semantic authority inside the same structured response;
the server then verifies record IDs, relation references, citations, coverage,
and disagreement without interpreting arbitrary English.

## QA5 Initial Review — T7 Implementation

```yaml
verdict: REQUEST_CHANGES
revision_round: 0
p0: 0
p1: 2
p2: 0
deployment_allowed: false
```

1. `P1_RECORD_RECEIPT_REUSE`: the authority manifest and materializer bind by
   `kind:model_id` without revalidating canonical record content. A complete
   `n` receipt for an invoice Claim can therefore be reused by a same-ID
   SecureDrop Claim; it remains active and persisted Q&A answers it. Model IDs
   also still participate in cross-batch deduplication.
2. `P1_INCOMPLETE_WORST_ENVELOPE`: the frozen byte measurements cover only
   private submission adjudication and authority tuples. They omit the complete
   public analysis with three citations per annotated record and the complete
   server receipt with occurrence/relation/lineage bindings, so the stated CER
   743-byte headroom is not a complete worst-case proof.

Independent broad gates still passed: focused 268/268, official 18/18,
`pnpm check` 700 passed/10 skipped, build, Playwright 14 passed/2 credentialed
live cases skipped, and `git diff --check`. T7 Revision 1 is limited to the two
P1 findings and must return to the same Reviewer before deployment.

## QA5 Revision-Round 1 — T7 Revision 1

```yaml
verdict: REQUEST_CHANGES
revision_round: 1
p0: 0
p1: 1
p2: 1
deployment_allowed: false
```

`P1_RECOVERED_RECORD_ORIGIN_COLLISION` remains: deterministic recovered Claims,
Requirements, and Evaluation rules can reuse a removed model record's public ID
and inherit its model origin through the post-recovery authority lookup. Those
borrowed origins can create a spurious submission-relevant conflict or veto.

`P2_BATCH_COUNT_COST_WORDING` corrects evidence wording: five is a packing
target and the observed CER batch count, not a global hard maximum. Dense valid
plans can contain seven or nine batches. Safety remains intact because the
pre-dispatch estimate uses the actual batch count and rejects totals above the
495,000 micro-USD reserve. Revision 2 must encode the recovered-record guard and
state/test cost using actual `N`.

## QA5 Revision-Round 2 — T7 Revision 2

```yaml
verdict: REQUEST_CHANGES
revision_round: 2
p0: 0
p1: 1
p2: 0
deployment_allowed: false
```

The recovered-origin collision and actual-`N` cost findings are independently
closed. `P1_RECORD_AUTHORITY_AUDIT_PERSISTENCE` remains: the actual non-empty
receipt byte length is transient between extraction and materialization, with no
RunRecord/database field or audit event. The required first controlled run could
not produce retrievable evidence. Final Revision 3 must persist an allowlisted,
non-body audit record by run ID for 30 days, separate from the 24-hour result,
and prove retrieval, expiry separation, and redaction in an integration test.

## QA5 Revision-Round 3 — T7 Revision 3

```yaml
verdict: APPROVE
revision_round: 3
p0: 0
p1: 0
p2: 0
deployment_allowed: true
```

The final receipt-audit finding is independently closed. A successful
production-shaped pipeline now writes a strict seven-field, non-body authority
audit atomically with the final result after cleanup and budget settlement.
The nullable audit is mapped bidirectionally through Neon schema v10, remains
after the 24-hour result scrub, and is removed with the run at the 30-day audit
expiry. The operator-only reader validates UUIDs, uses a parameter-bound query,
strictly validates stored JSON, and exposes no public route.

Independent evidence: focused audit suite 10/10, official Edmonton/CER fixtures
3/3, `pnpm check` 715 passed/10 skipped, production build passed, invalid CLI
input exited 64 with a sanitized error, and `git diff --check` passed. QA5 found
no remaining P0, P1, or P2 issue; normal migration and deployment gates may run.

## QA6 — T8 Publication/Submission Authority Separation

```yaml
verdict: APPROVE
revision_round: 0
p0: 0
p1: 0
p2: 0
deployment_allowed: true
```

The bounded reframe is independently accepted. Only four citation-publication
failures on exactly-once canonical non-submission records may become
`discarded`; those records are omitted with no lineage or Q&A authority. All
submission-relevant, unknown, missing/duplicate, tainted, relation-overlap,
mapping, integrity, and receipt-cap failures remain unresolved global vetoes.

Independent evidence: focused T8 suite 243/243, `pnpm check` 721 passed/10
skipped, official Edmonton/CER fixtures 3/3, production build, and
`git diff --check`. The internal receipt is v2; v1 full receipts remain
fail-closed, the private audit/CLI strictly dual-read 1|2, and no public API or
database migration changed.

## QA7 — T9 Source-Ledger Package Authority

```yaml
verdict: APPROVE
revision_round: 0
p0: 0
p1: 0
p2: 0
deployment_allowed: true
```

The all-page overlapping source ledger is independently verified as the sole
package-channel authority. Receipt v3 separates source binding, semantic
cross-check, and publication. Unlocated model records are suppressed without
denial-of-service authority; exact-source coverage/relation disagreements,
`n` overlap, exact `u`, ledger ambiguity/incompleteness, and prompt taint still
veto the package. Discarded records have no public, lineage, or Q&A authority.

Independent evidence: focused QA7 suite 148/148, `pnpm check` 731 passed/10
skipped, official Edmonton/CER fixtures 3/3, production build, and
`git diff --check`. The strict v3 audit contains only bounded enum counters plus
the existing non-body fields. No product/channel lexicon, public/API contract,
SQL schema, or migration changed.
