---
"@agent-native/core": patch
---

Directory widget read routes now run the workspace app access check for the session-authenticated callers they resolve, as the write routes already did, so a user denied access to a workspace app can no longer read its widget-scoped data. `share-resource`, `unshare-resource`, `set-resource-visibility` and `list-resource-shares` repeat the widget grant's resource binding inside the action, and the run context carries `mcpDirectoryWidgetResourceIds` for scoped widget reads. The embed session cookie is no longer sent when the signed token exceeds the browser's 4096-byte cookie limit; the page keeps using its query or bearer token.
