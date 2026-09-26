---
"@agent-native/core": patch
---

Route warmup no longer prefetches `.data` for paths the server answers itself (`/mcp`, `/.well-known`, `/api`, `/assets`, and the framework namespace), so links such as the MCP Connect page stop logging 404s.
