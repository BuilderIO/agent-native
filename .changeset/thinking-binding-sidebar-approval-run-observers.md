---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Anthropic turns with adaptive thinking no longer fail with "Invalid signature in thinking block" when the tool list changes mid-turn: requests ask the API to drop a mismatched thinking block. A pending approval in the agent sidebar is no longer replaced by the "no longer running" banner. `createAgentChatPlugin` gains `onAgentRunNotStarted`, and `onAgentRunComplete` now receives the thread projection outcome.
