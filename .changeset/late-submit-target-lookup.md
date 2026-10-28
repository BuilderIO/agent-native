---
"@agent-native/core": patch
---

`getAgentChatSubmitTarget(submitMessageId)` returns where a submission was routed: its chat tab and the first thread that tab reported running after it. Code that mounts after those one-time events can still find them, and never gets a thread the tab ran before the submission. Slides uses it to keep tracking a new deck's generation when the editor route loads after Home sends the prompt.
