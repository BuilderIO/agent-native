---
"@agent-native/core": patch
---

Document four newly-landed framework features in the published docs content:
pluggable sandbox adapters for the `run-code` tool (`SandboxAdapter`,
`AGENT_NATIVE_SANDBOX`, `registerSandboxAdapter`), the first-class evals CI gate
(`defineEval`, `createScorer`, built-in scorers, and the `agent-native eval`
command), the sub-agent delegation depth guard
(`AGENT_NATIVE_MAX_SUBAGENT_DEPTH`), and the `agent-native add` blueprint
installer. Adds `sandbox-adapters`, `evals`, and `blueprint-installer` pages, a
delegation-depth section in the Agent Teams doc, and surgical pointers in the
harness-agents, observability, and external-agents skills.
