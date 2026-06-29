---
"@agent-native/core": patch
"@agent-native/skills": patch
---

Make MCP install/connect idempotent for Codex `config.toml`. The writer now
recognizes a server's sub-tables (`[mcp_servers.<name>.http_headers]`,
`[mcp_servers.<name>.env]`, …) as part of its footprint, so re-installing or
reconnecting a server clears stale sub-tables instead of leaving one behind as a
duplicate TOML key. Same-URL alias cleanup removes the whole footprint too, and
the AGENTS.md / CLAUDE.md managed-instruction writers collapse any pre-existing
duplicate blocks into a single block.
