---
name: delegate-to-agent
description: >-
  How to delegate all AI work to the agent chat. Use when delegating AI work
  from UI or scripts to the agent, when tempted to add inline LLM calls, or
  when sending messages to the agent from application code.
---

# Delegate All AI to the Agent

## Rule

The UI and server never call an LLM directly. All AI work is delegated to the agent through the chat bridge.

## How

```ts
import { sendToAgentChat } from "@agent-native/core";

sendToAgentChat({
  message: "Analyze this candidate's resume",
  submit: true,
});
```

## Don't

- Don't import AI SDKs in client or server code
- Don't make direct API calls to any LLM provider
- Don't build "AI features" that bypass the agent chat

## Related Skills

- **scripts** — The agent invokes scripts via `pnpm action <name>`
- **self-modifying-code** — The agent operates through the chat bridge
