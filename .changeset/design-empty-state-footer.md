---
"@agent-native/core": patch
---

Add an `emptyStateFooter` slot to the agent chat, rendered below the empty-state suggestions. Unlike `threadFooterSlot` it never survives the first message, so a first-run affordance can sit with the suggestions without following the user through the conversation. Also forwards `onMessageCountChange` through `AgentPanel`/`AgentChatSurface` so a host can tell an empty thread from a started one. Fixes `onMessageCountChange` being swallowed by the multi-tab chat's own tab counter instead of reaching the host.
