---
"@agent-native/core": patch
---

Scope MCP Apps embed sessions to their resource and declared actions, and require browser cookie sessions for UI capabilities and approvals.

Apps with a custom `AuthOptions.getSession` resolver must also configure the cookie-only `getBrowserSession` hook to use UI capabilities and browser approvals. Without it, these operations return `401` and the server logs a migration warning.
