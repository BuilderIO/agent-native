---
"@agent-native/core": patch
---

Fix apps stuck on the `ClientOnly` loading spinner after sign-in when Vite 8's Rolldown dependency optimizer mis-bundled `recharts` → `es-toolkit` CJS compat (`require_isUnsafeProperty is not a function`). Exclude those packages from `optimizeDeps`, allow workspace root `node_modules` in dev server `fs.allow`, and lazy-load Context X-Ray so the treemap is not on the critical startup path.
