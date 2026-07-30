---
"@agent-native/core": patch
---

Recover background agent turns that stay alive without making real progress, retry transient run-event subscription failures with bounded backoff, keep reconnect diagnostics honest, and deduplicate repeated system prompts in thread debug history.
