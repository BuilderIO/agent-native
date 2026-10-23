---
"@agent-native/core": patch
---

Scope MCP Apps embed sessions to their resource and declared actions, and require browser cookie sessions for UI capabilities and approvals.

Apps with a custom `AuthOptions.getSession` resolver must also configure the cookie-only `getBrowserSession` hook to use UI capabilities and browser approvals. Without it, these operations return `401` and the server logs a migration warning.

MCP Apps embeds behind a proxy require the public origin configured through `APP_URL` or the workspace gateway URL unless the proxy connects over loopback.

Use the embed origin consistently for widget CSP and keep ordinary sign-in session lookup independent of embed origin validation.
