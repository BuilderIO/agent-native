---
"@agent-native/agentkit": patch
"@agent-native/core": patch
---

Reloading a chat no longer shows a second copy of a reply when folded runs streamed into the same assistant message, and that message keeps streaming when an earlier folded run settles. A continuation that starts after its predecessor finished now appends to that reply, and one that fails or never writes no longer changes its status. Reloading while a continuation is still carrying an earlier run's reply no longer leaves that reply streaming after the continuation finishes.
