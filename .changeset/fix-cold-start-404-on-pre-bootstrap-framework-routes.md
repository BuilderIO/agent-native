---
"@agent-native/core": patch
---

Fix a cold-start 404 on `/_agent-native/identity/*`, `/_agent-native/health*`, and `/_agent-native/embed/start`. These paths are excluded from the plugin-init readiness gate on the promise that they are already mounted, but three `await import(...)` calls in `createCoreRoutesPlugin` ran before their registration, so the first request to a cold serverless instance was released into a bare 404. Cross-app "Sign in with Agent-Native" returned through `/_agent-native/identity/callback`, which is almost always the first request a cold instance sees, so the sign-in round trip regularly ended on a "page not found" screen instead of a session.
