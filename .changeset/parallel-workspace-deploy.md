---
"@agent-native/core": patch
---

Build workspace apps in parallel during `agent-native deploy`, three at a time by default. Large workspaces were running into provider build time limits because every app built one after another. Set `AGENT_NATIVE_DEPLOY_CONCURRENCY` to change the limit.
