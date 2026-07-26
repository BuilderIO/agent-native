---
"@agent-native/core": patch
---

Stop action queries from spinning forever, and stop the sync loop from replaying
dead requests. The action fetch timeout now rejects the caller directly instead
of relying on `AbortController`, so a transport that ignores the abort signal (a
patched fetch, a wedged service worker, a body stream that never ends) surfaces a
typed 408 the UI can render and retry rather than an eternal loading skeleton.
`useDbSync` no longer refetches an action query whose last fetch failed with
401/403 — those repeat identically until the session changes, and one expired
session was reissuing them on every SSE/poll tick.
