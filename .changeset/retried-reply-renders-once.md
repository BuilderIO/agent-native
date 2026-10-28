---
"@agent-native/core": patch
---

A reply the agent rewrote after a final-answer check now shows once. Before, the chat kept the rejected draft and added the rewrite to its end, and a reload showed the rewrite again as a second reply. A streamed reply with a reasoning part is now replaced by its saved reply like any other.
