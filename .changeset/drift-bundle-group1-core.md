---
"@agent-native/core": patch
---

`useActionQuery` gains `foregroundRefetch`, so explicit refetches are sent as foreground reads. A visible first read that holds cached data counts as foreground, and a failing visible read stops claiming foreground after three retries. `invalidateForegroundActionQueries` is exported from the client hooks.

A plain Google workspace connect no longer pins the signed-in email as `login_hint`, so a second Google account can be chosen. Whether token rows are scoped per owner is now a per-provider setting instead of a hard-coded provider list.

The theme preference is stored per app: `themeStorageKeyForApp()` names the key, and `getThemeInitScript()` takes an optional `{ storageKey, legacyStorageKey }`. An existing shared `theme` choice is adopted once into the app's own key.
