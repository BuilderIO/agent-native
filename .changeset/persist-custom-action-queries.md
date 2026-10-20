---
"@agent-native/core": patch
---

Let hand-written action queries join the per-user persisted browser cache: `callAction` accepts `onResponse`, and `currentActionQueryCacheBinding` plus `recordActionQueryBrowserPersist` apply the same persist header and binding checks `useActionQuery` uses. `ACTION_BROWSER_PERSIST_HEADER` is exported from `@agent-native/core/shared` for routes that opt in.
