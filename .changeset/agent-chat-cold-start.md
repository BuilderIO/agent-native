---
"@agent-native/core": minor
---

Reliably deliver the first agent-chat message on a cold start (buffer it until a
chat thread exists instead of dropping it), and gate prompt boxes up front when
no provider key, Builder connection, or BYOK key is configured. New exports:
`useAgentEngineConfigured`, `BuilderSetupCard`, `parseSubmitChatMessage`.
