---
"@agent-native/core": patch
---

Add `resolveAdditionalActions` to `createAgentChatPlugin` so apps can add request-scoped actions for the signed-in caller, such as tools registered while the server runs. Interactive chat receives them by default; A2A and MCP `ask_app` receive them only when listed in `additionalActionSurfaces`. Entries are bound to their caller, checked and validated on every call, cannot reuse any built-in action name, and keep the same names for a chat run, including its hosted durable background continuations. Those continuations resolve the names again, so each entry has its current definition and is checked again. The caller's MCP tools are pinned the same way, so a saved action allowlist that names an MCP tool removed mid-turn no longer fails the durable continuation; calling that tool returns an error instead.
