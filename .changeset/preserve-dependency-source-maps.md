---
"@agent-native/core": patch
---

Limit Sentry source-map cleanup to files emitted by the current Vite build, preserve maps shipped with bundled dependencies, and skip uploads when no deployment build ID is available.
