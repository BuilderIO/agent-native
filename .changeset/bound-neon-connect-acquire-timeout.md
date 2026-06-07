---
"@agent-native/core": patch
---

Bound the Neon pooled-connection acquire with a timeout, not just the query. A cold or exhausted Neon pooler can stall on `pool.connect()`, which happens before the query-level `withDbTimeout` can fire — so authenticated requests (which run a session/org lookup on every navigation via `getSession` → `backfillSessionOrg`) hung until the platform killed the function, surfacing as "the app won't load" with lists, org switcher, and team pages stuck loading. The acquire now races the same `DB_OP_TIMEOUT_MS` budget and degrades into a retryable `CONNECT_TIMEOUT`, releasing the connection if it resolves after the timeout so the pool slot isn't leaked.
