---
"@agent-native/dispatch": minor
---

Add saved pointers: remember-pointer stores a name for an object in a workspace app (for example "todo list" for a doc), resolve-pointer looks one up over MCP, and route-app-intent opens a matching pointer's object before it asks the model. The route-app-intent cache key moves to v2 because pointers are now part of its input.
