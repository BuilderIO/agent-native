---
"@agent-native/agentkit": patch
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

A reply the agent rewrote after a final-answer check now shows once. Before, the chat kept the rejected draft and added the rewrite to its end, and a reload showed the rewrite again as a second reply. Now the draft leaves the screen when the server discards it, and a run that fails after a discard no longer leaves the draft behind. A streamed reply with a reasoning part is now replaced by its saved reply like any other.

AgentKit adds a `message.replaced` event, which swaps the parts of a message that is still streaming.
