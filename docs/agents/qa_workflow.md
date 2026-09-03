# Independent QA Workflow

The worker that implements a change may provide evidence but cannot issue the
final completion verdict.

## Review Sequence

1. Read governance, current context, specification, routing, QA gate, and
   implementation handoff.
2. Inspect the relevant diff or artifact.
3. Run or inspect every required acceptance check.
4. Run the declared regression checks.
5. Return `PASS`, `REQUEST_CHANGES`, or `BLOCKED`.

## Revision Rules

- For `REQUEST_CHANGES`, identify failed acceptance IDs and minimal evidence.
- Create a delta revision limited to the failed scope and affected regressions.
- Prefer the original implementer when the fix remains within its assignment.
- Re-run focused checks and then the required regression gate.
- After three failed rounds, stop and request redesign or human direction.
- For `BLOCKED`, identify whether evidence, environment, authority, or a product
  decision is missing.
