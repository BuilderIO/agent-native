---
"@agent-native/core": patch
---

`currentActionOriginCaller()` from `@agent-native/core/action` names the caller that started the action calls running now, such as `"mcp"` for an outside agent's tool call, so server code deep inside an action can tell who started it without trusting anything the request sent.
