---
"@agent-native/core": patch
---

Stop a chat run's event pump from re-arming itself forever once the AgentKit adapter is disposed. The pump restarted whenever its loop ended without a terminal event, so a run the adapter no longer tracked spun the event loop at full CPU.
