---
"@agent-native/core": patch
---

Stop losing the first dev database cleanup request after a dev server restart. A new Nitro worker now reports when its database close and resume listeners are ready, and the Vite plugin waits for that before sending a request, so an `.env` restart no longer waits out a 5 s timeout or logs that cleanup is "still waiting for active PGlite operations". A worker that never reports ready still fails after the same three bounded attempts, with an error that says it never became ready.
