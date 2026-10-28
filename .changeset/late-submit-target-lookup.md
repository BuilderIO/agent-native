---
"@agent-native/core": patch
---

`getAgentChatSubmitTarget(submitMessageId)` returns the chat tab a submission was routed to, so code that mounts after the one-time submit target event can still find it. Slides uses it to keep tracking a new deck's generation when the editor route loads after Home sends the prompt.
