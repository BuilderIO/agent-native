---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

`getAgentChatSubmitTarget(submitMessageId)` returns where a submission was routed: its chat tab and, when the routing chat knows it, its conversation thread. `reportAgentChatSubmitTarget` takes that thread as an option, and the multi-tab chat passes it. Code that mounts after the one-time target event can still find the route. Slides uses it to keep tracking a new deck's generation when the editor route loads after Home sends the prompt.
