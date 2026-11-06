---
"@agent-native/core": patch
---

Treat `null` on an optional tool field as absent when checking for ambiguous placeholders, so models that fill every unused field with `null` can call `resources` (skills, dashboards) again.
