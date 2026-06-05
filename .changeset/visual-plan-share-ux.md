---
"@agent-native/core": patch
---

Plan editor share + side-chat UX: the agent side chat now offers an inline,
account-free way to paste an Anthropic or OpenAI API key (progressive
disclosure next to the existing one-click Builder connect) and makes clear the
side chat is optional — you can keep editing with your own coding agent. Adds a
`saveAgentEngineApiKey` client helper for storing a bring-your-own provider key.
