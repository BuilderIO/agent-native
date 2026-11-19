---
"@agent-native/core": patch
"@agent-native/toolkit": patch
"@agent-native/dispatch": patch
---

Chat-first Dispatch asks its app route which app a sent message is about while the agent's turn starts, and opens that app's pane as soon as the route answers instead of waiting for the agent to open it. It starts the app's embed session right away. If the agent then opens the same app, that pane moves to the agent's page. If the agent opens a different app, that app replaces it. A chat-only, failed, unconfigured or late answer opens nothing, and so does any answer that arrives after a newer message or after the agent or the person changed the pane. `@agent-native/core/client/agent-chat` exports `reportAgentChatComposerSubmit`, `subscribeAgentChatComposerSubmit` and `agentChatPreviousTurnText`; the toolkit chat reports each foreground send through them.
