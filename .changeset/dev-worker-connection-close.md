---
"@agent-native/core": patch
---

In Vite dev, framework responses close their connection to Nitro's worker, so a burst of requests no longer fails with `read ECONNRESET` when the worker drops idle keep-alive sockets.
