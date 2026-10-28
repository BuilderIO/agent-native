---
"@agent-native/core": patch
---

`getAgentChatSubmitTarget(submitMessageId)` returns the chat tab a submission was routed to, and `getAgentChatRunningThreadId(tabId)` returns the conversation thread that tab last reported running, so code that mounts after those one-time events can still find them. Slides uses both to keep tracking a new deck's generation when the editor route loads after Home sends the prompt.
