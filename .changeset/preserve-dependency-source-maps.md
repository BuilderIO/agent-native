---
"@agent-native/core": patch
---

Limit Sentry source-map cleanup to files emitted by the current Vite build, preserve maps shipped with bundled dependencies, and bind uploads to the build ID embedded in the resolved client bundle.
