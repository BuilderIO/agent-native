---
"@agent-native/core": patch
---

Document prerendering in the scaffolded app's `react-router.config.ts`: a commented, correct example with the three conditions a path must meet (public, build-time constant, never redirecting), left off by default because every route the scaffold ships is signed-in and a prerendered file is served without auth middleware running.
