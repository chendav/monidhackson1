# Project Agent Guidelines

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
