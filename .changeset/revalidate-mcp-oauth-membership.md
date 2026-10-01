---
"@agent-native/core": patch
---

Removed organization members lose org access through MCP OAuth and connect tokens on their next request. The MCP endpoint, the MCP OAuth token endpoint (code exchange and refresh), and bearer-authenticated framework action routes and recap uploads re-check that the token's user still belongs to its organization. If that check, or the stored-org lookup for a connect token, cannot run, they answer a retryable 503 with `Retry-After` instead of a 401. `@agent-native/core/server` exports `isCredentialMembershipUnavailable` so app routes that resolve bearer sessions themselves can give the same answer. The A2A endpoint no longer accepts MCP connect or OAuth tokens. A connect token with no stored row now runs Personal instead of taking its `org_domain` organization. `registerIdentityColumns` accepts a new `offboard: "revoke"` policy, and offboarding uses it to revoke a member's MCP refresh and connect tokens, and deletes their MCP authorization and device codes, instead of transferring them to the successor.

Membership checks require readable organization metadata. The service-identity exemption requires an authenticated connect credential with a matching stored service kind, owner, and organization; human OAuth subjects with service-shaped email addresses still require live membership.
