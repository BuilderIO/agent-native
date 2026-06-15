---
"@agent-native/core": patch
---

Bound each PR visual recap MCP smoke probe with a per-attempt abort timeout so a
cold-start hang on the plan app fails fast and the workflow's retry loop can
re-probe a warm endpoint instead of blocking on undici's multi-minute default.
