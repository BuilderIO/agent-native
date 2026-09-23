---
"@agent-native/core": patch
---

Workspace agents now confirm a new app is actually served at `/<app-id>` before reporting it created, name the host's run/dev command when the preview isn't running the workspace gateway, and grant "admin" through app roles instead of hardcoding an email in an auth hook.
