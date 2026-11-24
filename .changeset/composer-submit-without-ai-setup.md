---
"@agent-native/toolkit": patch
---

`AgentKitComposer` accepts `submitRequiresAiSetup={false}` for a host `onSubmit` that never starts an agent run, such as a keyword search box, so its submit is not refused when no AI provider is connected. Host overrides stay gated by default.
