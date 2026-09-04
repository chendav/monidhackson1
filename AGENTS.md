# Project Agent Guidelines

## LLM-only document semantics

- Product decision from the user: LLMs must perform document meaning and
  relevance judgments. Do not use regular expressions, keyword dictionaries,
  lexical scoring, or hand-written phrase rules to determine requirements,
  submission methods, evaluation rules, amendment identity/order/replacements,
  risks, conflicts, or answers to document questions.
- Do not use those lexical techniques to select the only passages an LLM may
  inspect, or to silently veto an LLM's conclusion on semantic grounds. Use
  document-complete coverage and LLM-based relevance judgments instead.
- Document Q&A must use an LLM with the evidence needed to answer the question;
  keyword overlap over previously extracted conclusions is not Document Q&A.
- Deterministic code remains responsible for non-semantic operations: file and
  access validation, hashing, page indexing, exact evidence-span lookup, schema
  validation, arithmetic verification, storage, cleanup, and cost accounting.
  Exact quote matching establishes provenance, not semantic correctness.
- Missing evidence, ambiguity, or model failure must remain explicit. Never
  substitute a regex/dictionary semantic fallback or fabricate certainty.
- This is the required architecture boundary, not a claim that existing code
  complies. Development and paid tests remain paused during the user's current
  core-flow review until the user asks to resume implementation.

<!-- CHIEF-AGENT-ORCHESTRATION START -->
## Chief Agent Orchestration

- Use `docs/agents/chief_agent.md` as the entry point for explicitly requested
  Chief Agent or multi-agent work.
- For medium, large, risky, or cross-component tasks, create a task packet from
  `docs/specs/template/` before implementation.
- Before dispatch, update the four current files under `docs/agent_context/`.
- Select the smallest useful team from `docs/agents/role_catalog.yaml`.
- Treat subagents as stateless and give them bounded, path-based context.
- Require an implementation handoff and independent Reviewer verdict before
  closing meaningful delegated work.
- Development workers cannot self-certify completion.
- Limit revision loops to three rounds before redesign or human direction.
- Subagents may propose durable knowledge but may not promote it directly.
- Follow higher-priority runtime, security, approval, and repository rules.
- Do not infer permission for destructive, credential-sensitive, publishing, or
  external-side-effect actions from Chief Agent invocation.
<!-- CHIEF-AGENT-ORCHESTRATION END -->
