---
"@agent-native/core": patch
---

Export `runInBackground` from `@agent-native/core/server`, so an app can hand best-effort work to the platform's `waitUntil`, or wait for it at most a moment where the platform has none, instead of holding its answer for the whole job.
