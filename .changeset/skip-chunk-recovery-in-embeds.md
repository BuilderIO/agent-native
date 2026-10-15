---
"@agent-native/core": patch
---

Stop route chunk recovery from navigating transplanted MCP App embeds (Claude) to the host's origin, which the host blocks; report the failure instead.
