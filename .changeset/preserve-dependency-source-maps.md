---
"@agent-native/core": patch
---

Limit Sentry source-map cleanup to files emitted by the current Vite build so source maps shipped with bundled dependencies remain intact.
