---
"@agent-native/dispatch": patch
---

Resolve package-internal `@/*` imports to relative paths in published Dispatch
dist files so consumer SSR builds do not try to load app-local aliases.
