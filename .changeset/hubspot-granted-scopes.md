---
"@agent-native/core": patch
---

HubSpot workspace connections now record the scopes HubSpot actually granted. HubSpot returns them as a `scopes` array, which was ignored, so every connection showed the catalog's read-only list even when its token could write. The HubSpot connection also no longer sends a fixed scope list: HubSpot grants the scopes configured on the HubSpot app, so that app is the single source of truth. A new `list-workspace-connection-scopes` action lets any app, its agent, or an MCP host see which scopes the current user's connections hold before calling a provider API.

A user's own HubSpot connection now also powers HubSpot's MCP server in every app it is granted to, with no second sign-in. The token is resolved for each MCP request and never stored on the server config; organization-shared and other users' connections are never used. The generic `provider-api-request` agent tool is now read-only for HubSpot: reads (including search and batch reads) still work, and writes go through HubSpot's MCP tools or app-defined actions. Those reads include HubSpot's date-based API versions (`/crm/objects/2026-09/...` and `/crm/2026-09/objects/...`), and the provider API skill now tells coding agents to write new HubSpot code against a date-based version, the only kind that applies the portal's required-property rules to API writes.
