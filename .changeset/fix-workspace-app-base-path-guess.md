---
"@agent-native/core": patch
---

Fix Connect Builder (and other `agentNativePath`/`appPath` calls) building the wrong URL in a multi-app workspace dev gateway when the current page's client-side route (e.g. `/settings`) isn't itself a workspace app id. Previously `appBasePath()` would blindly trust the URL's first path segment as the workspace mount, producing URLs like `/settings/_agent-native/builder/connect` that the gateway 404s into its app-picker page instead of Builder's real sign-in screen. The guessed segment is now validated against the deployed workspace app manifest when one is available.
