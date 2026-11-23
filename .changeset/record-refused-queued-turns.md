---
"@agent-native/core": patch
---

Record a queued chat message whose turn is refused for a missing AI credential in its thread, the way a refused direct send is recorded: the prompt with its retry, and a failed run carrying the refusal. The refused-turn hook now carries the queued message's promotion claim, so saving the refusal passes the queue's claim check and the message leaves the queue instead of failing to save.
