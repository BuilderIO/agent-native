---
"@agent-native/core": patch
---

Stop a dropped Neon connection from crashing the whole serverless function. `@neondatabase/serverless` mirrors `pg-pool`, which removes its idle `error` listener while a client is checked out — so a WebSocket that drops mid-query (Lambda freeze/thaw, Neon "terminating connection due to administrator command", an idle socket the pooler closed) made the client emit an `error` event with no listener, which Node escalated to an uncaught exception that killed the function. This was the single highest-volume production crash. `attachNeonPoolErrorLogger` now attaches a persistent `error` listener to every client at connect time (covering all three pools — app, per-app, and Better Auth), so a dropped connection degrades to a logged warning and a reconnect on the next query instead of a process crash.
