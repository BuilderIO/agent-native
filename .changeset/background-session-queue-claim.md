---
"@agent-native/core": patch
---

Background agent sessions (`startBackgroundAgentSession`) start again. Since the queued-message claim check, the agent-chat route rejected every background session with 409 "Queued message promotion claim expired", because a session sends its operation id as `queuedMessageId` without a queue claim. The route now recognizes a background session by its derived turn id and accepts it once, as before; a repeat of the same operation is still deduplicated, and queued chat messages still need a live claim.
