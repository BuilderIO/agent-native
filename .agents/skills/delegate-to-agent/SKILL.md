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

The agent is the single AI interface. It has context about the full project, can read/write any file, and can run scripts. Inline LLM calls bypass this — they create a shadow AI that doesn't know what the agent knows and can't coordinate with it.

## How

**From the UI (client):**

```ts
import { sendToAgentChat } from "@agent-native/core";

sendToAgentChat({
  message: "Generate a summary of this document",
  context: documentContent, // optional hidden context (not shown in chat UI)
  submit: true, // auto-submit to the agent
});
```

**From scripts (Node):**

```ts
import { agentChat } from "@agent-native/core";

agentChat.submit("Process the uploaded images and create thumbnails");
```

**From the UI, detecting when agent is done:**

```ts
import { useAgentChatGenerating } from "@agent-native/core";

function MyComponent() {
  const isGenerating = useAgentChatGenerating();
  // Show loading state while agent is working
}
```

## `submit` vs Prefill

The `submit` option controls whether the message is sent automatically or placed in the chat input for user review:

| `submit` value | Behavior                                | Use when                                                                            |
| -------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| `true`         | Auto-submits to the agent immediately   | Routine operations the user has already approved                                    |
| `false`        | Prefills the chat input for user review | High-stakes operations (deleting data, modifying code, API calls with side effects) |
| omitted        | Uses the project's default setting      | General-purpose delegation                                                          |

```ts
// Auto-submit: routine operation
sendToAgentChat({ message: "Update the project summary", submit: true });

// Prefill: let user review before sending
sendToAgentChat({
  message: "Delete all projects older than 30 days",
  submit: false,
});
```

## Don't

- Don't `import Anthropic from "@anthropic-ai/sdk"` in client or server code
- Don't `import OpenAI from "openai"` in client or server code
- Don't make direct API calls to any LLM provider
- Don't use AI SDK functions like `generateText()`, `streamText()`, etc.
- Don't build "AI features" that bypass the agent chat

## Exception

Scripts may call external APIs (image generation, search, etc.) — but the AI reasoning and orchestration still goes through the agent. A script is a tool the agent uses, not a replacement for the agent.

## When to Use A2A Instead

`sendToAgentChat()` delegates work to the **local** agent — the one running alongside your app. When the work should go to a **different** agent entirely (e.g., asking an analytics agent for data, or a calendar agent for availability), use the A2A (agent-to-agent) protocol instead.

```ts
import { callAgent } from "@agent-native/core/a2a";

// Call a different agent — not the local agent chat
const stats = await callAgent(
  "https://analytics.example.com",
  "What were last week's signups?",
  { apiKey: process.env.ANALYTICS_A2A_KEY },
);
```

See the **a2a-protocol** skill for the full pattern.

## Related Skills

- **a2a-protocol** — When the work goes to a different agent, not the local one
- **scripts** — The agent invokes scripts via `pnpm script <name>` to perform complex operations
- **self-modifying-code** — The agent operates through the chat bridge to make code changes
- **storing-data** — The agent writes results to the database after processing requests
- **real-time-sync** — The UI updates automatically when the agent writes data
