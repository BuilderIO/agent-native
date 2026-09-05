---
"@agent-native/core": patch
---

Remove the `window.__agentNativeWebMcp` page helper when the last WebMCP registration stops, report an honest failed status from `ready()` when no registration exists, and keep same-origin `{ origin }` calls on the normal page listing so the polyfill does not reject them.
