---
"@agent-native/core": patch
---

Honor connect-minted MCP OAuth tokens on the HTTP action surface.

`agent-native connect` mints an MCP-audience OAuth access token and the local
Plans publish flow POSTs it (as `Authorization: Bearer`) to the hosted action
route `/_agent-native/actions/import-visual-plan-source`. That token is bound to
the app's MCP resource, not the legacy `sessions` table, so `getSession` never
resolved it on the action surface and `requiresAuth` actions like
`import-visual-plan-source` returned 401 — breaking `publish-visual-plan`.

`getSession`'s bearer path now falls back to the MCP surface's canonical
`verifyAuth` for any `Authorization: Bearer` request, so the action surface
honors exactly the tokens the MCP endpoint honors: same signature check, same
audience binding to this app's resource, same connect-token revocation gate. It
resolves to the same `{ email, orgId }` identity, so ownable-data scoping is
identical. Cookie/page loads (no bearer header) are unaffected, and tokens bound
to a different app's audience are still rejected.
