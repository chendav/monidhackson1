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

## QA8 — T10 Three Independent Delivery Contracts

```yaml
verdict: PASS
revision_round: 0
p0: 0
p1: 0
p2: 0
deployment_allowed: true
reviewed_base: 10ff4f53bd7d5dd5e313b5e53fa0ca0bb8a00973
```

Independent source tracing and adversarial reruns found no remaining defect in
the accepted T10 scope. The provider-private v2 format fixes the server batch
and ledger digests as literals and represents every server-owned candidate as
one required key of a strict object with no additional keys. The same generated
format object is passed to token counting and paid parsing. Returned candidate
metadata is reconstructed from server bindings; the existing offset,
confidence, condition, overlap, occurrence, prompt-taint, packing, cost and
deadline checks remain downstream of delivery validation.

Every private Claim, Requirement, Risk and Evaluation record requires inline
`submission_relevance`; the decoder removes it mechanically while constructing
the private authority rows. A 41-record probe crosses the former positional
40-tuple boundary, and the only remaining server guard is the 2,600-record sum
of the four strict collection maxima. A malformed batch is settled failed after
one paid dispatch and terminates before another batch or retry.

The three contracts remain independent: corrupt record authority suppresses
model records and their Q&A/lineage without suppressing a complete unique Email
ledger decision, while an incomplete source ledger withholds Email regardless
of complete record authority. Invented/paraphrased or unfamiliar SecureDrop
evidence remains unpublished and unavailable to persisted-evidence Q&A. No new
semantic/channel vocabulary or public API/UI contract was introduced.

The separate submission-adjudication audit is nullable JSONB under schema v11,
round-trips through both RunRecord/Neon mappings, survives 24-hour result scrub,
and is removed with the run at the existing 30-day audit expiry. Its strict
allowlist contains only fixed-length non-body integrity digest, bounded counts,
fixed enums/booleans, and a timestamp; it contains no source/quote/window text,
candidate or record ID, page value, offset, URL, or raw model output. The
operator-only reader validates and parameter-binds a UUID, strictly parses the
stored object, exposes no public route, and fails nonzero for invalid or absent
evidence. Migration 0010, journal order, schema marker, column mappings and the
offline database probe are complete; no database operation was performed.

Independent commands:

- `pnpm exec vitest run tests/unit/migrations.test.ts tests/unit/database-health.test.ts tests/unit/openai-adapter.test.ts tests/unit/submission-adjudication.test.ts tests/unit/record-authority.test.ts tests/unit/submission-adjudication-audit.test.ts tests/unit/record-authority-audit.test.ts tests/integration/record-authority-audit.test.ts`: 8 files, 121 tests passed.
- `$env:RFP_XRAY_FIXTURE_DIR='D:\monidhackson\.data\official-fixtures'; pnpm exec vitest run tests/golden/official-fixture-audit.test.ts`: Edmonton/CER 3/3 passed; generated dynamic-format and control-plane bounds matched the frozen measurements.
- `pnpm check`: lint and TypeScript passed; 58 files passed/4 skipped, 737 tests passed/10 skipped.
- `pnpm build`: Next production build passed with 9 Workflow steps, 5 workflows and 13 static pages.
- `$env:CI='1'; pnpm test:e2e`: 14 passed; 2 credentialed Railway live cases skipped.
- `git diff --check 10ff4f5` plus `git diff --no-index --check` for all four untracked T10 files: passed with only Windows line-ending notices.
- `node scripts/read-submission-adjudication-audit.mjs not-a-uuid`: sanitized failure, exit 64; a valid UUID without database configuration failed closed with exit 78.

The unchanged limits remain $2 per run, $20 per day, a $0.495 OpenAI extraction
reserve, a 50,000-token aggregate output cap, one attempt per paid batch and the
existing extraction/workflow deadlines. Provider acceptance of the dynamic
schema and actual T10 production audit values remain intentionally unknown until
the separately controlled post-QA deployment/run. QA8 permits that controlled
deployment gate; it does not convert the stale T9 production evidence into a
release-ready result.

## QA9 — T11 Provider-private bounded-relation repair

```yaml
verdict: PASS
revision_round: 0
p0: 0
p1: 0
p2: 0
deployment_allowed: true
reviewed_base: ed84568322113af168207810d6deeaeca6c3969d
```

Independent review found no remaining defect in the bounded T11 scope. The
strict provider-private schema fixes wire `v=3`, batch and ledger literals, and
the exact server-owned candidate-key object. Every private record collection
requires descriptive relevance, which is mechanically decoded to `s|n|u` and
removed before public Draft parsing (`src/lib/providers/openai.ts:186-272,
276-300`). Relations carry nonnegative `a`, `n` in 1..500, and confidence in
0.9..1; the decoder uses checked safe-integer addition (`openai.ts:314-329`).
The existing downstream verifier still enforces candidate windows, nonempty
spans, occurrence enclosure, condition containment, overlap agreement,
prompt-taint, and explicit ambiguous/unknown `semantic_uncertainty`
(`src/lib/analysis/submission-channel.ts:525-563`). Wire v2, length 0/501,
confidence .899, missing/extra keys, wrong literals, missing relevance, and
overflow all fail closed.

The same generated v3 format is used by token-count preflight and paid parsing,
with one non-retrying paid attempt per batch and existing aggregate token, cost,
and deadline gates unchanged (`openai.ts:991-1011, 1081-1246`). An unfamiliar
SecureDrop relation explicitly marked ambiguous/unknown at confidence .9 reaches
the server veto and cannot become a decisive channel. Canonical equivalent
records now use the full merge input when selecting merged IDs, and relevance
disagreement is represented by the bounded `mixed` counter rather than
misreported as missing (`src/lib/analysis/record-authority.ts:137-149,
496-523`).

Audit v4 strictly separates `integrity_complete` from `package_veto`, validates
`complete === integrity_complete && !package_veto`, and keeps historical v3
rows strict-readable (`src/lib/runs/record-authority-audit.ts:28-109, 121-137`).
The operator reader uses a UUID only for the parameter-bound lookup and returns
the strict audit allowlist without the raw run ID, body, URL, IDs, pages,
offsets, or provider output (`scripts/read-record-authority-audit.mjs:36-112`).

Recovered Evaluation precedence is keyed by verified document plus field, not
model ID or value, so valid model rules for that same recovered field are
excluded before reconciliation (`src/lib/analysis/materialize.ts:1655-1665`).
The shipped s/u test, the no-recovery control, and an additional read-only
in-memory probe with a separately source-valid contrary selection rule all kept
the recovered `Lowest evaluated price`; the contrary rule was removed without
creating a conflict.

Independent commands and results:

- Focused six-suite run: 6 files, 182 tests passed.
- Official local fixture audit with `RFP_XRAY_FIXTURE_DIR`: Edmonton/CER 3/3
  passed; v3 formatter/control-plane headroom matched the checked measurements.
- `pnpm check`: ESLint and TypeScript passed; 58 files passed/4 skipped, 742
  tests passed/10 skipped.
- `pnpm build`: production build passed, including 9 Workflow steps, 5
  workflows, and 13 generated page entries.
- `$env:CI='1'; pnpm test:e2e`: 14 passed; 2 credentialed Railway live-storage
  cases skipped as required by this review.
- `node scripts/read-record-authority-audit.mjs THIS_RAW_RUN_ID_MUST_NOT_ECHO`:
  exit 64 with only `record_authority_audit_invalid_run_id`.
- Local dynamic-schema inspection confirmed format name
  `rfp_xray_analysis_v3`, `strict=true`, exact required candidate keys with no
  additional properties, `n` 1..500, and confidence .9..1.
- `git diff --check`: passed with Windows line-ending notices only. Scoped
  changed-content secret scan found zero key, token, private-key, credentialed
  database-URL, or AWS-key matches. No public API/UI/SQL migration changed.

Actual provider acceptance and post-T11 production counts remain intentionally
unknown until the separately controlled deployment and paid falsification run.
QA9 permits that controlled next gate; it does not itself establish final
release readiness.

## QA10 — T12 Canonical ownership-core submission ledger

```yaml
verdict: REQUEST_CHANGES
revision_round: 0
p0: 0
p1: 1
p2: 0
deployment_allowed: false
reviewed_base: 680014b2ce4c8af641bb5a8d2f24d031dc12e8c5
```

### P1_QA10_HALO_CONTEXT_BECOMES_RECORD_AUTHORITY

T12 correctly makes relation ownership midpoint-based, but downstream record
citation authority still treats every context window that contains a quote as
an authority unit. `exactOccurrences` collects all enclosing candidates by
context bounds (`src/lib/analysis/record-authority.ts:456-494`), and the
cross-check declares an occurrence covered when any of those candidates is
verified (`record-authority.ts:604-615,629-668`). It does not select the unique
candidate whose owned core contains the occurrence midpoint.

The independent counterexample placed `Bids must be lodged through SecureDrop.`
at `[2685,2724)` across the 2700 core boundary. Its midpoint owner was core
`[2700,5224)`, which returned `coverage=uncertain`; adjacent core `[0,2700)`
was complete, had the quote only in its right halo, and returned no relation.
The source-ledger artifact correctly became incomplete with
`semantic_uncertainty`, but record authority classified a model-authored
`financial` Requirement marked `n` as `exact_bound / consistent / verified`,
with `package_veto=false`. Materialization kept the SecureDrop Requirement
active while `summary.submission_method=null`, and persisted-evidence Q&A
answered it. The Q&A path intentionally admits active non-submission-category
requirements under null submission authority
(`src/lib/analysis/closed-world.ts:56-65`), so the incorrect source-binding
decision is user-visible.

This violates the accepted T12 invariant that halo is context, not authority,
and weakens unfamiliar-channel fail-closed behavior. Deployment is blocked.
The minimum acceptance is for every exact citation occurrence to use only its
deterministic midpoint owner candidate for coverage and relation cross-checks.
If that owner is uncertain or unresolved, the record must not publish or answer
Q&A even when an adjacent halo-containing candidate is complete. Existing
non-owner relation `ownership_mismatch`, unique-owner relation publication,
same-owner duplicate/conflict failure, and official fixture behavior must
remain intact.

### Passing independent evidence

- The Chief-proposed 500-unit halo boundary concern was falsified. With
  midpoint `start + floor((length-1)/2)`, a 500-unit span owned at
  `coreEnd-1` ends at the exclusive offset `coreEnd+250`, exactly inside the
  250-unit halo. An exhaustive read-only probe checked all 2,875,750 legal
  spans of lengths 1..500 on a 6,001-unit page; every span had exactly one
  owner and fit its owner's context.
- Focused T12 suites: 6 files, 165 tests passed.
- Official Edmonton/CER fixture audit: 3/3 passed. Edmonton remained 85 cores
  in 3 batches with v4 bounds `5426/6005/7318`; CER remained 116 cores in 5
  batches with `4834/4766/4800/5928/7006`.
- `pnpm check`: ESLint and TypeScript passed; 58 test files passed/4 skipped,
  750 tests passed/10 skipped.
- Invalid submission-audit CLI input exited 64 and printed only
  `submission_adjudication_audit_invalid_run_id`; strict historical v1/current
  v2 audit tests passed.
- `git diff --check` passed with Windows line-ending notices only. Scoped secret
  scan found zero key/token/private-key/credentialed-database/AWS-key matches,
  and no public API, UI, database, migration, pipeline, budget, or deadline path
  changed.

Build and Playwright were not repeated after the definitive P1 reproduction;
their implementer-reported passes cannot override this release-blocking semantic
counterexample.

## QA10 Revision 1 — Halo-context record-authority fence

```yaml
verdict: PASS
revision_round: 1
p0: 0
p1: 0
p2: 0
deployment_allowed: true
reviewed_base: 680014b2ce4c8af641bb5a8d2f24d031dc12e8c5
```

The failure-scoped delta closes
`P1_QA10_HALO_CONTEXT_BECOMES_RECORD_AUTHORITY`. Exact citation occurrence
binding now requires both full context containment and the unique candidate
whose half-open core contains `start + floor((quote.length - 1) / 2)`
(`src/lib/analysis/record-authority.ts:475-484`). Adjacent halo-only candidates
cannot satisfy source coverage or contribute relation cross-check authority.

The original independent `[2685,2724)` SecureDrop counterexample was rerun
outside the added fixture. With the midpoint owner marked uncertain and the
adjacent halo marked complete, source adjudication remains incomplete, the
model `n` Requirement becomes `coverage_gap / unknown / discarded`, public
materialization omits it, and persisted-evidence Q&A returns `not_found`.
The private receipt retains its audit origin key, but the existing materializer
returns no publication lineage for discarded authority. The positive owner-core
relation, both page-edge citations, non-owner `ownership_mismatch`, same-owner
duplicate/conflict, mixed-relevance package veto, and unchanged budget/retry
paths also pass.

Independent commands and results:

- Focused Revision-1 regression gate: 4 files, 129 tests passed.
- Official Edmonton/CER fixture audit: 3/3 passed; Edmonton remains 85 cores/3
  batches and CER 116 cores/5 batches with the accepted v4 bounds unchanged.
- `pnpm check`: ESLint and TypeScript passed; 58 test files passed/4 skipped,
  753 tests passed/10 skipped.
- `pnpm build`: production build passed with 9 Workflow steps, 5 workflows and
  13 generated page entries.
- `$env:CI='1'; pnpm test:e2e`: 14 passed; 2 credentialed Railway live-storage
  tests skipped.
- `git diff --check`: passed with Windows line-ending notices only; no product
  path outside the two-line record-authority fix and scoped tests changed in the
  revision.

Actual provider acceptance and post-T12 production results remain unproven and
belong to the separately controlled deployment/run gate. QA10 Revision 1
authorizes that gate; it does not itself make the overall release ready.

## QA11 — Domain-bounded coverage and relation-relative conditions

```yaml
verdict: PASS
revision_round: 0
p0: 0
p1: 0
p2: 1
deployment_allowed: true
```

Independent review confirmed that delivery-domain coverage distinguishes
complete-empty unrelated cores from plausible unresolved delivery relations;
unfamiliar whole-bid SecureDrop resolves only to source-bound generic
`electronic`, while question-only SecureDrop does not become a package channel.
Wire v5 rejects v4 and malformed condition shapes, converts a single
relation-relative condition coordinate system, and retains server containment,
canonical ownership, mixed-relevance, relation-gap, prompt-taint, one-call,
no-retry, cost, and deadline gates.

Evidence: focused T13/authority tests 165/165; closed-world/security/authority
tests 94/94; official Edmonton/CER audit 3/3; `pnpm check` with 757 passed and
10 skipped. The Reviewer used the accepted layered cadence and relied on the
frozen handoff's already successful build and browser run instead of repeating
them. No network, provider, paid, deployment, commit, or push action occurred.

Non-blocking P2: the runtime relation Zod object is not strict and strips unknown
sibling properties when called directly. The provider-facing generated JSON
Schema has `additionalProperties:false`, and stripped values cannot influence
authority. Record `.strict()` hardening for later; it does not block the T13
deployment proof.

## QA12 — Stable Monid semantic contract fingerprint

```yaml
verdict: PASS
revision_round: 0
p0: 0
p1: 0
p2: 0
deployment_allowed: true
```

Independent review confirmed one shared semantic projection is imported by the
runtime and release script. Explicit allowlists ignore only reviewed telemetry,
catalog, and presentation fields; unknown root, request-schema, or pricing
semantics fail closed. Identity, strict request fields and validation keywords,
the full USD tier structure, configured adapter paths, artifact hosts,
credential bindings, deployment identity, and terminal validation remain bound.

Evidence: focused provider/runtime/script/receipt/pipeline suites 49/49; health
contract 15/15; an independent 18-case mutation matrix rejected or changed the
digest for every material mutation while telemetry/description/title/label
changes stayed stable; runtime/shared-module parity matched; `pnpm check`
passed with 762 tests and 10 skips. No network, credential, paid, deployment,
commit, or file mutation occurred during independent review.

The application retains its existing 25 MiB limit while documentation labels
the provider's “25 MB” unit unverified. This truth boundary is not promoted to
machine-verified provider evidence.

## QA13 — Demand-aware OpenAI output capacity

```yaml
verdict: REQUEST_CHANGES
revision_round: 0
p0: 0
p1: 1
p2: 0
deployment_allowed: false
reviewed_base: a9b8832aefc3447448470cb69db6f5a97553a9e4
```

### P1_QA13_RESPONSE_INPUT_USAGE_CAN_ESCAPE_OPENAI_RESERVE

The new output balance itself conserves 50,000 tokens, but a provider response
whose syntactically valid `input_tokens` exceeds the exact preflight count is
accepted as successful and may authorize later paid batches above the original
495,000-micro-USD OpenAI reserve. `validatedResponseUsage` checks only that both
counts are nonnegative safe integers (`src/lib/providers/openai.ts:416-431`).
The preflight reserve is computed from the earlier token counts
(`openai.ts:1169-1185`), while successful settlement prices the unbounded
response count and recomputes only future output capacity
(`openai.ts:1277-1295,1312-1325`). There is no comparison between response input
usage and that batch's preflight count, nor a second OpenAI-reserve gate before
the next dispatch. The pipeline passes these values to the generic run-cost
ledger, whose ceiling is the broader USD 2 run reservation rather than the
495,000-micro-USD OpenAI sub-reserve (`src/lib/pipeline.ts:952-970`).

Two independent in-memory probes used the real adapter and no network. With a
one-batch preflight count of 100, a complete schema-valid response reporting
`input_tokens=1,000,000` and `output_tokens=10` returned success and emitted a
750,045-micro-USD settlement from a 225,075-micro-USD pending maximum while the
configured OpenAI reserve was 495,000. A stronger four-batch probe used exact
preflight counts of 80,000 per batch and a first response count of 120,001.
The initial total commitment was 465,002; after the first settlement it became
495,003, and the adapter still dispatched all four batches. Subsequent
pre-dispatch totals remained 495,002, 495,001, and 495,001. Thus the frozen
implementation under-reserves future paid work when the count and response
usage disagree, despite both values satisfying its current validation.

Minimum acceptance is failure-scoped: bind accepted response input usage to
the batch's exact preflight count (or otherwise prove and enforce the same
495,000-micro-USD cumulative OpenAI ceiling), settle any already-returned
provider anomaly truthfully, and dispatch no later paid batch after a mismatch.
Add single- and multi-batch regressions showing a larger syntactically valid
response input count cannot produce a successful result or a later paid call.
Do not alter the 50,000 output balance, retry policy, prompts, schemas, context,
or deadlines.

### Passing independent evidence

- `pnpm exec vitest run tests/unit/openai-adapter.test.ts --reporter=dot`:
  48/48 passed.
- CER-only saved official replay with `RFP_XRAY_FIXTURE_DIR` and test filter
  `verifies every CER`: 1/1 passed, two Edmonton cases skipped. Floors remained
  `[6312,6240,6229,7721,9429]` (35,931 total) and the first cap 20,381.
- A separate randomized read-only probe exercised 4,500 valid allocator plans
  across one through nine batches. Every case preserved
  `accounted + current cap + future floors = 50,000`, kept the current cap at
  least its floor, and rejected negative/zero/over-cap invalid plans.
- Targeted ESLint and `pnpm exec tsc --noEmit` passed. `git diff --check` had
  Windows line-ending notices only; the scoped diff secret scan found no
  credential, bearer token, private key, provider URL, or API-key addition.
- The exact-schema floor is derived by parsing the combined minimum Draft and
  maximum dynamic v5 submission-control envelope, then conservatively counting
  UTF-8 bytes. Missing/invalid output usage consumes the full requested cap,
  above-cap output and incomplete output stop without retry, and capacity
  failure occurs before token counting or paid dispatch in the passing focused
  tests.

No build, Playwright, provider call, paid call, deployment, migration, commit,
push, or Edmonton reparse was performed. The definitive P1 blocks deployment;
broader release gates were not repeated.

## QA13 Revision 1 — Response input-usage reserve binding

```yaml
verdict: PASS
revision_round: 1
p0: 0
p1: 0
p2: 0
deployment_allowed: true
reviewed_base: a9b8832aefc3447448470cb69db6f5a97553a9e4
```

The failure-scoped delta closes
`P1_QA13_RESPONSE_INPUT_USAGE_CAN_ESCAPE_OPENAI_RESERVE`. After retaining the
returned response ID and valid usage, the adapter now rejects
`usage.input_tokens > batchInputTokens` before decoding or publication
(`src/lib/providers/openai.ts:1275-1302`). The ordinary failed-settlement path
records observed cost, sets future commitment to zero, returns a non-retryable
`ModelBatchError`, and exits the sequential loop before another paid dispatch.

Independent in-memory reproductions used the real adapter without network:

- Preflight 100, response 1,000,000/10: exactly one parse, failed settlement
  750,045 micro-USD with zero remaining commitment, zero completed batches,
  retained response ID and 1,000,000/10 usage, `retryable=false`.
- Four preflights of 80,000, first response 120,001/10: exactly one parse and
  only batch 0 started, failed settlement 90,046 micro-USD with zero remaining
  commitment, no later call or retry, zero completed batches, retained response
  ID and 120,001/10 usage.
- Response input usage 99 and 100 against preflight 100 both completed and
  settled successfully with their reported usage, confirming the strict upper
  boundary.

`pnpm exec vitest run tests/unit/openai-adapter.test.ts --reporter=dot` passed
52/52. The revision is limited to the same-request input-usage comparison and
four focused regressions. Static review confirmed the protected allocator,
prompts, v5 schemas, GPT-5.4 Mini model, 50,000 output cap, 495,000-micro-USD
reserve, zero-retry settings, request ordering, context checks, and deadlines
remain unchanged. `src/lib/config.ts` and the CER golden test have no Revision-1
delta. Scoped `git diff --check` and credential-pattern scan passed.

Per the explicit Revision-1 cadence, no official fixture, full check, build,
browser test, network/provider call, paid call, deployment, commit, or push was
performed. QA13 Revision 1 permits the ordinary Chief release-candidate gate;
it does not by itself prove production CER completion or overall release
readiness.
