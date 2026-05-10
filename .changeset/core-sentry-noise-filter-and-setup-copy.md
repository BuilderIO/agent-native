---
"@agent-native/core": patch
---

- AssistantChat: clearer Builder-setup card copy ("Turn on the AI assistant" / "One click to connect Builder for free hosted access — no API keys needed").
- Sentry: drop `AgentAutoContinueSignal` (control-flow sentinel) on the browser side and `ForbiddenError` / `UnauthorizedError` on the server side from captured events. They aren't real failures and were burying actionable bugs in the Sentry issue list.
