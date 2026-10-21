---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

An agent's connection request card now stays in the chat. Saved chat history keeps `connection.requested` and `connection.updated`, so the card survives a thread reload or page refresh, and a chat that is waiting on an open connection request no longer shows the "server says this chat is no longer running" notice while the server's run has ended by design.
