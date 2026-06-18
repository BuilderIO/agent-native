---
"@agent-native/core": patch
---

Fix intermittent 404s on `/_agent-native/actions/*` (and other framework routes)
on serverless deploys. Routes are registered inside an async plugin init that
Nitro v3 does not await, and the production Nitro dispatcher snapshots its
middleware list once at the start of h3's `handler()` — so the readiness-gate
middleware, which runs inside that snapshot, could await init yet still fall
through to a bare 404 (surfaced in the client as a `true` error toast) for a
request that arrived on a cold isolate. The readiness wait now also runs as a
Nitro `request` hook, which h3 awaits before route + middleware resolution, so
late-registered routes exist by the time routing happens. The existing
middleware gate is retained as a fallback.
