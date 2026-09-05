# MH-002 core-flow reframing review

Advisory only. Product implementation and paid tests remain paused.
Observed baseline: `6a2d81e34bf7e67abfda33e0eb71e0ad32d8e364` (Chief-reported).
Recommended Chief disposition: **DEFER migration until experiment evidence**.

## Subsystem and trigger evidence

The subsystem is document interpretation from indexed pages through publication and Q&A.
CodeGraph 0.9.9 was consulted before source navigation: initial status was fresh,
192 files / 3,101 nodes / 8,216 edges; final observed status was fresh at 194 files.
Used `query`, `files`, `callees`, `callers`, and `impact`; verified their findings in source.
Confirmed paths: `processRun` → `materializeAnalysis` → recovery/reconciliation;
questions `POST` → `answerFromPersistedEvidence`. Static edges are navigation, not runtime proof.

## Confirmed, inferred, unknown

- **Confirmed in source:** the six boundaries below assign document meaning to deterministic rules.
- **Confirmed in project records, not rerun here:** T20/T22 retained verified citations but published empty collections; T23–T25 changed citation coordinates and ownership; T26/T27 identified a separate receipt-capacity problem. See the MH-002 tops and historical evidence in `docs/agent_context/`.
- **Inferred:** competing semantic authorities explain multiple recovery and veto special cases; a single LLM decision path should simplify them.
- **Unknown:** changed-prompt accuracy, unseen-document recall, latency, cost, and full-document Q&A retention acceptance. This review read no `.data` artifacts and ran no tests/providers.

## Six highest-impact mismatches

1. **Identity before interpretation.** `src/lib/pipeline.ts:135` `amendmentFromIndex` and `:141` `solicitationFromIndex` read only the first three pages with regexes. Their values enter manifests (`:146`) and model inputs (`:984`). An unfamiliar identity label or later contradictory identity cannot be adjudicated here. Preserve user-supplied roles as assertions; let the LLM validate document identity and precedence against full-document evidence.
2. **Semantic recovery bypasses the model.** `src/lib/analysis/materialize.ts:893` invokes source recovery before authority handling. `source-anchors.ts:459` `recoverMandatoryTableAnchors` creates mandatory requirements from M-number/obligation patterns; `:588` creates security requirements from four phrase templates; `:370` and `:693` create evaluation rules and checklist-conflict claims. Exact quotation proves location, not these classifications. Replace recovery with explicit LLM omission handling; do not silently manufacture missing facts.
3. **Publication reinterprets model conclusions.** `materialize.ts:141` `proseAssertionSupportedByCitations` applies word inclusion, polarity and conditionality rules; `:126` contains an Edmonton-specific qualifier exception. `:604` `validatedEvaluationRule`, `:757` summary checks, and `:862` mandatory checks infer relevance, value roles and obligation class. Risk lineage also uses word dictionaries (`:186`, `:235`, `:271`). Move these judgments into evidence-backed LLM decisions; keep structural validation and arithmetic on already-typed values.
4. **Amendment identity and replacement are lexical.** `reconciliation.ts:268` `deriveSourceFactKey`, `:292` `canonicalTopicKey`, `:544` `mutationIsSourceAuthorized`, and `:621` `topicsLikelyAlias` infer same-object identity and mutation meaning; alias thresholds are 0.45/0.75 at `:658`. `:661` ranks amendment labels numerically. The LLM must resolve targets, explicit precedence, replacement scope and conflicts; code may then apply validated decision IDs and check acyclicity, reference integrity and ordering consistency.
5. **Delivery meaning is compressed into a global single-channel rule.** `submission-channel.ts:359` does cover every page core, but `:444` sizes relation capacity from known lexical occurrences. `:827` `resolveVerifiedSubmissionChannel` compares amendment/base signatures, requires one possible channel and a required relation; `materialize.ts:2040` uses that result and `:2064` withholds alternatives. This cannot represent all legitimate conditional/multiple delivery choices as the LLM's final decision. Retain full-page coverage and provenance; move the package delivery conclusion to the LLM and preserve conditions/alternatives explicitly. Legacy channel checks at `materialize.ts:1153`/`:2030` are conditional, not evidence that every live record uses them.
6. **Public Q&A performs no LLM reasoning.** `src/app/api/v1/runs/[runId]/questions/route.ts:36` calls `closed-world.ts:46` `answerFromPersistedEvidence`. Token overlap selects one retained result and score ≥2.4 means answered (`:31`–`:100`); null submission summary excludes all claims, risks and conflicts, including unrelated ones. `OpenAIResponsesAdapter.answer` at `providers/openai.ts:1527` deliberately throws to prevent unledgered paid calls. Replace this service with an owned, budgeted LLM Q&A path using source evidence; calling the existing stub is insufficient.

## Recurring symptoms and attempted patches

Repeated symptoms are correct-looking citations followed by empty results, source wording
exceptions, recovered/model identity collisions, and unrelated answers withheld by submission state.
Historical fixes addressed quote offsets, representation, ownership, publication coupling and capacity;
these are distinct failure classes and should not all be attributed to semantic heuristics.
Source tests document the current behavior: `tests/unit/closed-world.test.ts:95` gates entire
collections, `closed-template-recovery.test.ts:114` recovers two fixed evaluation rules,
and `materialize-reconciliation.test.ts:3198`/`:3350` exercise checklist identity and recovered M1–M4.
Their assertions are evidence of design choices, not refreshed passing results.

## Accidental variables and underlying problem

Provider fragment IDs, a model-written topic, M-number labels, a known-channel count,
the first three pages, and one nullable submission field are implementation boundaries.
The domain problem is smaller: determine what supplied documents require, how later
documents affect earlier statements, what is uncertain, and which evidence supports each answer.

## Invariants

- Every factual assertion and semantic relation has inspectable source evidence and an LLM decision origin.
- Every document page is covered; budgets/chunking may bound transport, never silently prune semantic coverage.
- Unknown, conflicting, unsupported and unavailable evidence remain distinguishable; blank prices never become zero.
- Physical quote matching establishes provenance only. Neither exact matches nor confidence scores certify meaning.
- Access checks, hashing, page coordinates, schemas, arithmetic, spending, deletion and expiry remain deterministic.

## Current ontology and canonical state

Current drafts contain summaries plus claims/requirements/evaluation/risks, a private delivery ledger,
record-authority receipts, and recovered records. Meaning can be accepted by one layer and rejected
or reconstructed by another. Public collections become the only Q&A corpus after source cleanup.
`draft.ts:9` represents mutation as topic/document/amendment/effect; public contracts omit much
of this lineage (`src/contracts/analysis.ts:60` onward). Missing typed lineage invites later guessing.

## Proposed minimum model and pipeline

Use four small records, not a general procurement ontology:

- **Evidence document:** original hash, physical pages, immutable text/representation version, lifecycle owner.
- **Evidence span:** document/page/offset/quote hash, raw quote, and exact mapping to actually issued source text.
- **Decision:** kind, typed value or statement, scope/conditions, supporting span IDs, explicit uncertainty, model/prompt version; same-object, replaces/deletes/conflicts and risk dependencies refer to decision IDs and have their own cited LLM justification.
- **Processing receipt:** issued-input hashes, completed/missing coverage units, structural/provenance failures, attempt/cost/deletion receipts. It must not imply semantic correctness.

Three LLM phases suffice initially: (1) complete document extraction and identity judgments;
(2) package reconciliation, support checking and final summaries/risks with access to cited context
and all source units through LLM-based relevance selection; (3) question-specific reasoning over
the available document corpus. Exact span resolution and schema checks follow each output.
At most one bounded repair may address a named missing/invalid item; failure remains explicit.
No regex recovery, keyword-only passage selection, or semantic veto is an alternate success path.

## Genuine Q&A and retention tradeoff

The current pipeline clears model text/coverage (`pipeline.ts:1066`) and requires cleanup before
questions (`questions/route.ts:29`). Post-cleanup full-document Q&A needs a product decision.
Recommend explicit opt-in encrypted, owner-scoped normalized page evidence for at most 24 hours,
with visible expiry/delete controls, deletion receipts and a precise updated cleanup contract.
Without opt-in, preserve immediate deletion and request source re-provision when full evidence is
needed; an LLM over retained conclusions must be labelled limited-evidence assistance.
Do not silently extend production retention. Add per-question idempotency, reservation/settlement,
ownership and cancellation/expiry fences before enabling paid Q&A; record failed attempts too.
Budget or evidence unavailability must not be reported as “not found in the documents.”

## Counterfactual, eliminated heuristics and contrary evidence

The minimum model should eliminate both template recovery and lexical re-validation, plus
topic-alias/mutation dictionaries and Q&A overlap scoring. Stable evidence IDs should reduce
model/recovered record reconciliation and global answer suppression.
It would not have prevented T26's capacity failure, invalid source mappings, or actual model
omissions. Current submission scanning already reads complete cores and permits unfamiliar
mechanisms (`submission-channel.ts:586`); reuse that coverage property. A monolithic prompt
could simply relocate complexity and still fail on cross-document context.

## Smallest falsification experiment, acceptance and rollback

No experiment is executed by MH-002. After the user resumes implementation:

1. On a separate branch/cache namespace, freeze saved real Edmonton/CER source and response hashes; replay with network disabled. Trace every candidate to its first rejection and compare current results with a prototype provenance-only projector. Do not alter original responses or count recovered facts as new model output.
2. Pre-register a small evidence checklist spanning mandatory vs contractual obligations, 50/94 and 70/30 roles, blank price, checklist conflict, a replacement chain, permitted/conditional delivery alternatives, and unrelated Q&A while delivery remains uncertain. Include absent/ambiguous/wrong-document citation controls. This zero-provider stage tests representation and projection only.
3. Only under separately authorized bounded model spend, capture the new prompts once on those source units plus a small unrelated holdout and paraphrase variants; require every unit to be LLM-inspected. Reuse cached parsing, record actual cost/latency, and perform all later debugging by replay. This is the first evidence about changed-model semantics; excerpt success alone cannot approve whole-package migration.

Accept a later migration proposal only if the independent Reviewer sees no unsupported decisive
answers, no lost pre-registered core facts, correct source/role/condition/replacement handling,
explicit ambiguity, complete coverage receipts, and measured cost/latency within the predeclared
budget. It must demonstrably remove at least two heuristic families. Missing a core fact,
inventing a replacement, bypassing uncertainty, or requiring new phrase rules falsifies this scope.
Rollback is removal of the isolated prototype/cache namespace and restoration of the unchanged
baseline path; no production schema, retention, or release switch is authorized by this review.

## Chief disposition and proposed memory

**DEFER migration** is the recommended disposition: source evidence supports the boundary mismatch,
but no new-model falsification result exists. The Chief and independent Reviewer own acceptance.
Proposed durable memory: none; the user's LLM-only boundary is already recorded in AGENTS.md.

Chief disposition: **DEFER migration**. The independent QA1 PASS approves the
index/baseline/planning deliverable only. Execute no migration or paid experiment
until the user resumes implementation and the bounded experiment gate is satisfied.
