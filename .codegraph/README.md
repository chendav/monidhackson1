# RFP X-Ray code index

CodeGraph 0.9.9 was initialized on 2026-09-04 for the pre-refactor baseline.
The live SQLite index is `.codegraph/codegraph.db` and is machine-local, as
specified by CodeGraph's generated `.gitignore`. Git stores this rebuilding
guide and a source-inventory fingerprint, not SQLite/WAL/lock files or secrets.

## Rebuild and inspect

From the repository root, with CodeGraph available:

```powershell
codegraph init .
# For an already initialized checkout:
codegraph sync .
codegraph status --json
codegraph files --format flat --no-metadata
codegraph query materializeAnalysis --kind function --json
codegraph callees materializeAnalysis --json
codegraph impact answerFromPersistedEvidence --json
```

The installed version supports `query`, `files`, `callers`, `callees`, `impact`
and `affected`; it does not expose `explore` or `node`. Use these supported
commands for CodeGraph-first navigation, then read the relevant source lines.

## Boundaries

- Graph edges are static navigation evidence, not a guarantee of complete
  runtime dispatch, call resolution, or test coverage.
- Indexed languages here are TypeScript, TSX, JavaScript and YAML. Markdown,
  JSON, SQL, CSS and binary media are not represented as code in this index.
- Git-ignored dependencies, environment files and `.data` caches are excluded;
  the recorded inventory was checked for those paths.
- `baseline-index.json` describes the baseline snapshot; later source changes
  require `sync`. The snapshot is not a product-readiness or release certificate.
