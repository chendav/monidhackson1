# Problem Reframing Protocol

Use this protocol when repeated local difficulty suggests that the current
representation, ontology, ownership boundary, or canonical state may be wrong.
Its purpose is to test a better problem model, not to reward abstraction for its
own sake.

## Authority Boundary

Reframing is advisory and read-only with respect to product code, production
state, schemas, and canonical knowledge. It produces a hypothesis and a
falsification experiment. The Chief decides whether to accept, reject, or defer
the hypothesis. Accepted migrations return to the ordinary specification,
implementation, and independent-QA workflow.

## Trigger Reframing Mode

Use project-specific thresholds when they exist. Otherwise use these defaults:

- `review_at: 3` heuristic-debt items in one subsystem;
- `mandatory_at: 5` heuristic-debt items;
- `block_local_heuristics_at: 8` until a review is dispositioned; and
- `repeated_fix_attempts: 2` for the same failure class.

Count a heuristic-debt item when a change adds an ununified special-case branch,
magic threshold, provider/camera/model-specific rule, recovery patch, or
duplicated reconciliation path. Record evidence, not merely a score. Merge or
remove items when a general rule actually replaces them.

Qualitative triggers can override the count when state ownership is ambiguous,
multiple bugs share one boundary, implementation identities are mistaken for
domain entities, or synchronization logic keeps growing.

## Review Procedure

### 1. Collect Symptoms

List recurring failures, attempted fixes, special cases, unstable identities,
duplicated concepts, reconciliation paths, and failed or variant tests. Preserve
the concrete evidence and timeline.

### 2. Strip Accidental Details

Describe the problem without current class, table, API, provider, sensor, model,
or UI names. Identify which variables and boundaries exist only because of the
current implementation.

### 3. Recover the Underlying Problem

State the smallest domain problem represented by the symptoms. Generalize only
far enough to unify the observed cases.

### 4. Identify Invariants

Name what remains stable across implementations, executions, sensors,
providers, views, or representations. Distinguish real entities from temporary
observations and identifiers.

### 5. Examine Canonical State

Record what the system currently treats as authoritative, competing sources of
truth, ownership boundaries, and the most natural candidate for canonical
state.

### 6. Propose the Minimum New Model

Introduce only the objects and relationships needed to explain the evidence. A
valid proposal must simplify at least two existing failure modes or eliminate
multiple special cases. Renaming the same exceptions is not a reframing.

### 7. Run the Counterfactual Test

Ask: "If this model had existed from day one, would the observed bugs or
heuristics still be necessary?" Record exceptions and contrary evidence.

### 8. Design a Falsification Experiment

Define the smallest reversible experiment that could prove the proposal wrong.
Specify its fixture or dataset, expected observation, failure condition, cost,
scope, and rollback. Do not begin broad refactoring to perform the experiment.

## Required Review Output

Write `reframing_review.md` with:

- subsystem and trigger evidence;
- recurring symptoms and attempted patches;
- accidental variables and boundaries;
- underlying problem statement;
- invariants;
- current ontology and canonical state;
- proposed minimum model;
- failure modes or heuristics expected to disappear;
- counterfactual result and contrary evidence;
- smallest falsification experiment;
- migration hypothesis, risks, and rollback boundary; and
- Chief disposition: `ACCEPT`, `REJECT`, or `DEFER` with evidence.

## Validation Gate

The Chief may approve migration only when the falsification experiment has
evidence, the proposed model materially simplifies observed cases, product and
data ownership remain clear, and an independent reviewer accepts the experiment
result. A rejected or deferred hypothesis goes into the project record so later
agents do not rediscover it without new evidence.
