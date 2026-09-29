---
"@agent-native/core": patch
---

Add `callAgent` to `IntegrationsPluginOptions`. It defaults to `true`; set it to `false` to leave `call-agent` out of messaging turns, which matches what agent-chat's `workspaceApps` tool group already allows on the web. `call-agent` is in `DEFAULT_INITIAL_TOOL_NAMES`, so it is on every first request even when it is not in `initialToolNames`. A deployment that shares no A2A secret with the first-party apps therefore had messaging turns calling `analytics` or `content` and getting back `401 Invalid or expired A2A token`, when the app's own connection had the answer.
