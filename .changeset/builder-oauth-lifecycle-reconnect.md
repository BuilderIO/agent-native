---
"@agent-native/core": patch
---

Builder OAuth now relies on the shared credential lifecycle for refresh single-flight and reconnect state instead of duplicating them in `settings` rows. The `builder-oauth-refresh:*` lease and `builder-oauth-reconnect:*` flag are gone; a failed refresh latches `reconnect_required` on the credential itself. Adds `markOAuthReconnectRequired` (and the `markMcpOAuthReconnectRequired` MCP wrapper) so a server-side 401/403 rejection can force reconnect through the credential rather than a side channel.

Builder OAuth is scoped to the caller's organization: every member of an org shares one Builder connection and token, resolved from the authenticated user's own org membership. Every user belongs to an org, so there is no per-user fallback — a missing org is a broken invariant that fails loudly rather than silently creating a personal connection. Previously every user shared one `account_id`, so under the `(provider, account_id)` primary key only the first person to connect could hold a grant and everyone else was refused.

Because the grant is shared, connecting (which overwrites it) and disconnecting (which revokes it for everyone) require org owner/admin authority.
