# MH-002 handoff

## Assignment

Index the current repository, checkpoint/push preserved work, and prepare an
LLM-only semantic redesign plan without implementing it.

## Inspected files

AGENTS.md; project/skill governance; four current context files; .gitignore;
package.json; CodeGraph status/files/query/call graph; pipeline.ts; openai.ts;
analysis/{closed-world,materialize,source-anchors,reconciliation}.ts; prior
T26/T27 evidence and diffs; CI configuration and vercel.json.

## Changed files

MH-002 authored only .codegraph metadata/README, task documentation, current
context and task registry. Baseline commit also preserves the pre-existing
T27 source/test changes and earlier AGENTS.md LLM rule; those are not new
implementation performed by this task. See `git show --stat 6a2d81e`.

## Decisions

Keep CodeGraph database local according to its own ignore rules. Version
rebuild instructions and inventory fingerprint. Publish an explicitly incomplete
pre-refactor checkpoint; separate a following documentation-only plan commit.

## Confirmed

- CodeGraph0.9.9 initialized;194 files,3101 nodes,8216 edges,7847936-byte database;
  pending changes0 and worktreeMismatch null at baseline capture.
- Query/callees show materializeAnalysis -> recover* helpers; source confirms
  semantic regex/dictionary recovery. Callers/impact show questions POST ->
  answerFromPersistedEvidence; source confirms keyword scoring and global gate.
- OpenAIResponsesAdapter.answer throws MODEL_UNAVAILABLE; no paid Q&A exists.
- Baseline `6a2d81e34bf7e67abfda33e0eb71e0ad32d8e364` pushed to origin/main;
  `git ls-remote --heads origin main` returned that exact SHA.

## Inferred

Separating model semantics from provenance/mechanical code should reduce several
shared failure modes. This hypothesis needs the proposed experiment; no product
quality or performance improvement has been demonstrated in this planning task.

## Unknown

New prompt accuracy/latency/cost; accepted Q&A retention choice; complete product
golden gates and prior T27 release pin/review.

## Checks and exact outcomes

- `git diff --cached --check`: PASS before baseline commit.
- Tracked-path audit:364 files,352 text files scanned; forbidden env/cache/PDF/DB/
  video paths0; only `.env.example` tracked among env matches.
- Redacted high-confidence content scan:0 findings for private keys, OpenAI-style
  keys, GitHub tokens, AWS access IDs, credentialed Postgres URLs and signed
  source URLs. This limited scan is not proof of absence of every secret format.
- Indexed-path exclusion audit:0 env/cache/dependency/PDF/database/video paths.
- Git push:fast-forward fc85c24 ->6a2d81e; remote equality PASS.
- Automatic GitHub CI33931253588:lint/typecheck PASS;841 tests passed,5 failed,
  12 skipped. One selection fingerprint mismatch and four missing `.data`
  realpath failures; build/browser skipped. Read-only CI inspection, no rerun.
- No manual product tests, paid calls, migrations, direct deployments or release actions.

## Assumptions

The user requests a recovery baseline, not certification of the old behavior.
The improvement plan is a proposal; product implementation remains paused.

## Risks

Static graph limitations; baseline known incomplete behavior and observed CI
failures. Full Q&A requires an explicit evidence-lifecycle decision.

## Follow-ups

Independent QA1 returned PASS with no must-fix findings; record in qa_report.md.
Close metadata, sync graph, push the documentation-only commit and verify remote
SHA. Future product work remains paused; migration is DEFER pending experiment.

## Proposed long-term memory

None. User's LLM-only boundary already exists in AGENTS.md. Task-local source
findings stay in this packet; no unreviewed knowledge promotion.

## Memory Disposition

None proposed; none promoted. Keep source observations and the deferred migration
hypothesis as task-local evidence. The existing user-authored rule is unchanged.
