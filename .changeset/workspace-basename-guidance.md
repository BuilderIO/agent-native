---
"@agent-native/core": patch
---

New apps scaffolded from the default template serve their root when mounted in a workspace at `/<app-id>`, instead of returning 404. Workspace and starter guidance now points at `configureClientRouterBasename()` for mounted apps and at `agent-native add-app` for adding an app to a workspace.
