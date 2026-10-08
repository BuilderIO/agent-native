---
"@agent-native/agentkit": patch
---

Place the "tool-call history was omitted" note before the user's prompt in `sendMessage` requests, so the request ends on the user's turn instead of a synthetic assistant message.
