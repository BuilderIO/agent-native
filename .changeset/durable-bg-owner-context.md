---
"@agent-native/core": patch
---

Durable background agent-chat: actually run the background worker. The
self-dispatch into the Netlify background function is cookieless (HMAC-only), so
the worker had no session and `resolveOwnerContext` threw 401 "Unauthenticated"
before it could even claim the run — every durable run died at the route
boundary (`route_threw`) and only completed via the foreground circuit-breaker's
inline recovery, never using the 15-minute background budget. The `_process-run`
route now resolves the owner securely from the run's chat thread
(`getRunOwnerEmail(runId)` — DB-derived from the HMAC-signed run row, not the
forgeable request body) and pre-seeds the owner context, so the background
worker runs with the correct authenticated owner and the full background budget.
