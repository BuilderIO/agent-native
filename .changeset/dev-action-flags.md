---
"@agent-native/core": patch
---

Actions the dev server loads from an app's `actions/` folder keep the same settings a production build keeps. The dev scan carried only a few of them, so in dev an action with `needsApproval` ran without asking, its schema defaults were not applied before a `retrySafe` predicate read the input, and settings such as `timeoutMs`, `parallelSafe` and `capabilityScopes` were ignored.
