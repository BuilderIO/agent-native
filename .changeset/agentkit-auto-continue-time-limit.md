---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Continue an AgentKit chat turn automatically, in the same turn, when the server stopped it at its run time limit: at most three times per message, counted durably on the server, never after an error, stop, or credential or rate limit. Finished steps and cross-app delegations are reused instead of sent again, the chat shows a Resuming status with Stop still available, and past the cap the turn ends with Continue.
