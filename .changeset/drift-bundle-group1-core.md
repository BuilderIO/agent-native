---
"@agent-native/core": patch
---

MCP embed tools outside directory listings now open as full apps in the host side panel. The full-app session is minted only for a verified MCP user, anchored to the credential issue time, and inline cards stay pinned to their UI resource. A browser opening the public `/mcp` URL as a page now reaches the app's own route instead of the MCP protocol handler.

`useActionQuery` gains `foregroundRefetch`, so explicit refetches are sent as foreground reads. A visible first read that holds cached data counts as foreground, and a failing visible read stops claiming foreground after three retries. `invalidateForegroundActionQueries` is exported from the client hooks.

A plain Google workspace connect no longer pins the signed-in email as `login_hint`, so a second Google account can be chosen. Whether token rows are scoped per owner is now a per-provider setting instead of a hard-coded provider list.

The theme preference is stored per app: `themeStorageKeyForApp()` names the key, and `getThemeInitScript()` takes an optional `{ storageKey, legacyStorageKey }`. An existing shared `theme` choice is adopted once into the app's own key.
