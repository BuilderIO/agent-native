---
"@agent-native/core": patch
---

Scope MCP Apps embed sessions to their resource and declared actions, and require browser cookie sessions for UI capabilities and approvals.

Apps with a custom `AuthOptions.getSession` resolver must also configure the cookie-only `getBrowserSession` hook to use UI capabilities and browser approvals. Without it, these operations return `401` and the server logs a migration warning.

MCP Apps embeds use the validated public request URL. Forwarded host and protocol headers are honored only for a loopback proxy; configuring an allowed origin does not establish proxy trust.

When public origins are configured, embed audiences and widget origins must match that allowlist. Hosted proxies must preserve an allowed public request URL.

Use the embed origin consistently for widget CSP and keep ordinary sign-in session lookup independent of embed origin validation.

Keep Visual Edit capabilities on their declared action set and automatic source synchronization on the signed-in user's own write access.

Keep card read manifests limited to their declared reads, and require a browser session for localhost write consent.

An ambient capability cookie does not override an independently authenticated browser account on an unmarked action request. Marked embed requests keep their scoped restrictions, and UI capabilities still require a same-origin browser-cookie identity.

App-catalog session tools advertise generic path and URL inputs only when an action handler is declared; widget renewal remains available independently.
