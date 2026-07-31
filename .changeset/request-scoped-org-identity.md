---
"@agent-native/core": patch
---

Cut one database round trip from every authenticated request. The membership
and `active-org-id` reads behind org resolution now overlap instead of queueing,
and `resolveOrgIdForEmail` memoizes its `org_members` read per request (keyed on
the AsyncLocalStorage request context and the email) so credential lookups,
agent runs, A2A, MCP, and adapter-authenticated action calls — none of which
carry an h3 event — stop each paying their own lookup.
