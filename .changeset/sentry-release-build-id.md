---
"@agent-native/core": patch
---

Skip the Sentry source-map upload when a build has no deployment identifier instead of publishing every such build to one shared `agent-native-client@development` release, and derive the client build id from the same merged env the upload reads so events and uploaded maps always name the same release.
