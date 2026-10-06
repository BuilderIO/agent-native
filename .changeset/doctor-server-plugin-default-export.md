---
"@agent-native/core": patch
---

Add a `server-plugin-default-export` doctor guard that flags `server/plugins/` files with no default export, so `agent-native build` stops with a clear fix instead of failing later in the bundler with `[MISSING_EXPORT]`.
