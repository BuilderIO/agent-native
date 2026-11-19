---
"@agent-native/core": patch
"@agent-native/toolkit": patch
"@agent-native/dispatch": patch
---

Chat-first Dispatch asks its app route which app a sent message is about while the agent's turn starts, and opens that app's pane as soon as the route answers instead of waiting for the agent to open it. It starts the app's embed session right away. If the agent then opens the same app, that pane moves to the agent's page; if it opens a different app, that app replaces it. Nothing opens for a chat-only, failed, unconfigured or late answer. Nothing opens either when the answer arrives after a newer message, after a send was rejected, after the agent or the person changed the pane, or after the person left that chat. `@agent-native/core/client/agent-chat` exports `reportAgentChatComposerSubmit`, `withdrawAgentChatComposerSubmit`, `subscribeAgentChatComposerSubmit` and `agentChatPreviousTurnText`; the toolkit chat reports each visible send through them.
