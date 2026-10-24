---
"@agent-native/core": patch
---

Actions the dev server loads from an app's `actions/` folder keep the same settings a production build keeps. The dev scan carried only a few of them, so in dev an action with `needsApproval` ran without asking, its schema defaults were not applied before a `retrySafe` predicate read the input, and settings such as `timeoutMs`, `parallelSafe` and `capabilityScopes` were ignored. When the dev server can't import an action and falls back to running it through `pnpm action`, it now parses the source for `needsApproval` and `persistInBrowser` too. Only a literal `needsApproval: false` skips the approval prompt, and only a literal `persistInBrowser: true` lets the browser keep results. A predicate, a variable, or options it can't see (spread in from another object, passed by name, built by another helper or re-exported) make the action ask every time and keep its results out of the browser. If it can't read or parse the source either, it does both.

Every action loader also dropped `persistInBrowser`, in production too, so a GET action that set it to `false` still had its results saved to the browser's query cache. That included the framework's own API key list, email log bodies and infrastructure status. Loaded actions now keep it.
