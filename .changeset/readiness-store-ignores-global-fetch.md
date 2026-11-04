---
"@agent-native/core": patch
---

Keep the Connect AI setup card visible when anything wraps `window.fetch` after the page mounts, such as session replay or error-tracking instrumentation. Agent engine readiness and status-request caches no longer key on the global `fetch` identity; callers that pass no explicit `fetch` now share one store and cache entry per URL, credentials and headers.
