---
"@agent-native/core": patch
---

Workspace provider OAuth start (`/_agent-native/connections/oauth/<provider>/start`) no longer stores a connection under the hard-coded app id `creative-context` when the request omits `appId`. It now uses the current app's identity (`app.workspaceId`, then `app.id`), so the connection the user approves is granted to the app that started the flow. When no app id can be resolved, the route returns a 400 ("OAuth start requires an app id.") instead of guessing, and an invalid `appId` returns a 400 instead of a server error.
