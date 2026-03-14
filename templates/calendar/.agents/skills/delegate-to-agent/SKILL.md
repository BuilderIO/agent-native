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
  context: documentContent,  // optional context to include
  submit: true,              // auto-submit to the agent
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

## Don't

- Don't `import Anthropic from "@anthropic-ai/sdk"` in client or server code
- Don't `import OpenAI from "openai"` in client or server code
- Don't make direct API calls to any LLM provider
- Don't use AI SDK functions like `generateText()`, `streamText()`, etc.
- Don't build "AI features" that bypass the agent chat

## Exception

Scripts may call external APIs (image generation, search, etc.) — but the AI reasoning and orchestration still goes through the agent. A script is a tool the agent uses, not a replacement for the agent.
