---
"@agent-native/core": patch
---

Convert an action's schema to JSON Schema when its parameters are first read, not when the action is defined, so a cold server instance stops converting every action's schema at startup.
