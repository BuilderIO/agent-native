---
"@agent-native/core": patch
---

`set-resource-visibility` takes `resourceIds` to change up to 100 resources of one type in one call. It checks every resource before changing any, puts back earlier writes if a later one fails, and lists each resource as changed or unchanged.
