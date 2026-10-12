---
"@agent-native/core": patch
---

Add `resolveAdditionalActions` to `createAgentChatPlugin` so apps can add request-scoped actions for the signed-in caller, such as tools registered while the server runs. Interactive chat receives them by default; A2A and MCP `ask_app` receive them only when listed in `additionalActionSurfaces`. Entries are bound to their caller, checked and validated on every call, cannot reuse any built-in action name, and stay fixed for the length of a chat turn.
