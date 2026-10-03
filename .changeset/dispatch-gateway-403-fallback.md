---
"@agent-native/dispatch": patch
---

Show a deployment's own apps when the workspace registry refuses the signed-in user (HTTP 403) instead of an error card; an HTTP 401 from the registry still fails loudly.
