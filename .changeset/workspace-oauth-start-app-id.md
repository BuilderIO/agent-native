---
"@agent-native/core": patch
---

Workspace provider OAuth start (`/_agent-native/connections/oauth/<provider>/start`) no longer stores a connection under the hard-coded app id `creative-context` when the request omits `appId`. It now uses the current app's identity (`app.workspaceId`, then `app.id`), so the connection the user approves is granted to the app that started the flow. For non-Sigma providers, an unresolved app id or invalid `appId` returns 400. Sigma returns 403 when the current app cannot be resolved, the requested scope is not user-scoped, or a supplied `appId` does not match the current app.
