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

## Why

The agent is the single AI interface. It has context about the full project, can read/write the database, and can run scripts. Inline LLM calls bypass this — they create a shadow AI that doesn't know what the agent knows and can't coordinate with it.

## How

**From the UI (client):**

```ts
import { sendToAgentChat } from "@agent-native/core";

sendToAgentChat({
  message: "Summarize the sprint progress",
  submit: true,
});
```

**From scripts (Node):**

```ts
import { agentChat } from "@agent-native/core";

agentChat.submit("Process the uploaded data and update the dashboard");
```

## Don't

- Don't `import Anthropic from "@anthropic-ai/sdk"` in client or server code
- Don't `import OpenAI from "openai"` in client or server code
- Don't make direct API calls to any LLM provider
- Don't build "AI features" that bypass the agent chat

## Related Skills

- **scripts** — The agent invokes scripts via `pnpm script <name>` to perform complex operations
- **self-modifying-code** — The agent operates through the chat bridge to make code changes
