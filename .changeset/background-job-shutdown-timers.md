---
"@agent-native/core": patch
---

Stop in-process background job timers on Nitro close so a graceful SIGINT can drain the event loop.
