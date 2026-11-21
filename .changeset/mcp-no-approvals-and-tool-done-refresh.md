---
"@agent-native/core": patch
---

Ensure MCP review gates resolve no-approvals mode from verified MCP user identity when request-context email is absent, and ensure `window` `agent-native:tool-done` events reliably refetch active `useActionQuery` queries in place across multi-subscriber `useDbSync` trees and apps without `useDbSync`.
