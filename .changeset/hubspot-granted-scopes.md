---
"@agent-native/core": patch
---

HubSpot workspace connections now record the scopes HubSpot actually granted. HubSpot returns them as a `scopes` array, which was ignored, so every connection showed the catalog's read-only list even when its token could write. The HubSpot connection also no longer sends a fixed scope list: HubSpot grants the scopes configured on the HubSpot app, so that app is the single source of truth. A new `list-workspace-connection-scopes` action lets any app, its agent, or an MCP host see which scopes the current user's connections hold before calling a provider API.
