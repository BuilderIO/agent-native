---
"@agent-native/core": patch
---

Export `isClientDraftThread` and `markClientDraftThread` from `@agent-native/core/client/agent-chat`, so a route can tell a chat created on this client apart from a saved thread that has gone missing.
