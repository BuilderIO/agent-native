---
"@agent-native/core": minor
---

`app-skill` packer now generates auto-updating plugin manifests so installed plugins pick up skill changes without a manual re-pack: Claude Code marketplace entries set `autoUpdate: true` (with commit-SHA plugin versioning) and Codex plugin versions embed a content hash of the bundled skills plus the MCP endpoint. This backs distributing the Agent-Native Plan app (and any app-backed skill) as a one-install Claude Code / Codex marketplace plugin that bundles the skills and the hosted MCP connector together.
