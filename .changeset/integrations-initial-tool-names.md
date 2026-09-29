---
"@agent-native/core": patch
---

Add `initialToolNames` to `IntegrationsPluginOptions`. Messaging turns sent every action the app passed in on their first request; an app with a large action surface can now name the tools to load up front, as it already does for agent-chat, and the rest stay discoverable through `tool-search`. Unset, the behaviour is unchanged.
