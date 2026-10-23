---
"@agent-native/core": patch
---

Actions the dev server loads from an app's `actions/` folder keep the same settings a production build keeps. The dev scan carried only a few of them, so in dev an action with `needsApproval` ran without asking, its schema defaults were not applied before a `retrySafe` predicate read the input, and settings such as `timeoutMs`, `parallelSafe` and `capabilityScopes` were ignored. When the dev server can't import an action and falls back to running it through `pnpm action`, it now reads `needsApproval` from the source too, so the action still asks before it runs. If it can't read the source either, the action asks every time.

Every action loader also dropped `persistInBrowser`, in production too, so a GET action that set it to `false` still had its results saved to the browser's query cache. That included the framework's own API key list, email log bodies and infrastructure status. Loaded actions now keep it.
