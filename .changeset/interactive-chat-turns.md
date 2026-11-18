---
"@agent-native/core": minor
---

Add `agent.interactiveChatTurns` (`AGENT_INTERACTIVE_CHAT_TURNS`). When enabled, a chat turn its signed-in owner sends from the app's own page runs as interactive provider work, and a durable run it hands off to carries a turn grant signed for that run, so its own tool calls stay interactive and `isProviderInteractiveScope` reports them as interactive to provider call gates; a recovery successor run does not inherit the grant. Off by default.
