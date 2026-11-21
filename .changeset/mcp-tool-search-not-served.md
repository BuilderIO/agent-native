---
"@agent-native/core": patch
---

MCP `tool-search` now names the closest actions an app's own agent can run that the connection can't call. They come back under `notServed`, up to three with a short description each, with a message to hand the task to `ask_app`, so a capability kept off MCP no longer reads as one the app lacks. Only a signed-in person who may call `ask_app` gets them, and never for a menu search or a `readOnlyOnly` one. Denied, framework and turn-ending actions stay unnamed, as does anything the caller's OAuth scope or the app's discovery checks hide. When those checks fail or run past the search's deadline, the search comes back without `notServed`. `externalAgents.writes: "ask_app_only"`, set or implied by `authenticatedReads: "auto"`, is deprecated and warns once at startup: decide each write on its action instead, with `mcpTool: false` to keep it in the app.
