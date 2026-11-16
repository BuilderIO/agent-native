---
"@agent-native/core": minor
---

Workspace deploys now cache each app's build. An app whose source, built workspace-package outputs, lockfile, Node major, preset and build environment are unchanged restores its previous build output and function bundle instead of rebuilding. Cache problems always rebuild with a typed miss reason, never ship a partial restore, and `AGENT_NATIVE_DEPLOY_CACHE_VERIFY` rebuilds a sample of cached apps and fails on any output difference. Turn it off with `AGENT_NATIVE_DEPLOY_CACHE=false`.
