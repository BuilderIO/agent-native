---
"@agent-native/agentkit": patch
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

A reply the agent rewrote after a final-answer check now shows once. Before, the chat kept the rejected draft and added the rewrite to its end, and a reload showed the rewrite again as a second reply. Now the draft leaves the screen when the server discards it, and a run that fails after a discard no longer leaves the draft behind. A reply the agent sends together with its follow-up suggestions is now the final answer. Before, the server erased it and asked the model again, which wrote a short recap of a reply that was no longer on screen. A streamed reply with a reasoning part is now replaced by its saved reply like any other. While a turn is still working, its steps stay in one live row above the reply, even when the agent writes a line between steps. Before, each such line closed the steps above it into a "Worked for" row while the agent kept working, so the turn showed two rows. Lines the agent writes between steps also show as separate lines while they stream, instead of running together.

AgentKit adds a `message.replaced` event, which swaps the parts of a message that is still streaming.
