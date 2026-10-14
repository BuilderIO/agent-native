---
"@agent-native/core": patch
---

Point the Gong provider catalog at Gong's semantic MCP tools for account and deal questions instead of paging raw call endpoints.

Provider requests that come back truncated now say the body is incomplete and name the recovery, and the shared corpus prompt orders provider-side search ahead of scanning records locally.
