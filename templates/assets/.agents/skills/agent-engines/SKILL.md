---
name: agent-engines
description: >-
  How to inspect and configure the AI engine (model provider) powering the
  agent. Use when the user asks to switch models, check which engine is active,
  test a new provider, or register a custom engine.
---

# Agent Engines

## Overview

The framework supports pluggable AI engines beneath the agent loop. The **Anthropic engine** is the default and best-in-class path (Claude models). Additional engines can be added via the Vercel AI SDK (OpenAI, Google Gemini, Groq, Mistral, Cohere, Ollama).

## Available Tools

| Tool | Purpose |
|---|---|
| `list-agent-engines` | List all registered engines, their capabilities, and the current selection |
| `set-agent-engine` | Set the active engine and model (persisted in settings) |
| `test-agent-engine` | Send a trivial prompt to verify the engine works (connectivity + API key) |

## Checking the Current Engine

```
list-agent-engines
```

Returns the registry of all engines (name, label, capabilities, supported models) plus the currently active engine and model.

## Switching Engines

```
set-agent-engine --engine "ai-sdk:openai" --model "gpt-4o"
```

Changes take effect on the next conversation. The setting is persisted via the settings store (`agent-engine` key).

Resolution order (highest priority first):
1. Explicit `engine` option passed to `createAgentChatPlugin()` in the server plugin
2. Settings store (`agent-engine` key)
3. `AGENT_ENGINE` environment variable
4. Default: `"anthropic"` (requires `ANTHROPIC_API_KEY`)

## Testing a New Engine

Before switching, verify the engine is working:

```
test-agent-engine --engine "ai-sdk:openai" --model "gpt-4o"
```

Returns `{ ok, latencyMs, response, capabilities }`. If `ok: false`, the error message explains what's wrong (missing API key, package not installed, etc.).

## Built-in Engines

| Engine Name | Provider | Requires |
|---|---|---|
| `anthropic` | Anthropic Claude SDK | `ANTHROPIC_API_KEY` |
| `ai-sdk:anthropic` | Claude via Vercel AI SDK | `ANTHROPIC_API_KEY` |
| `ai-sdk:openai` | OpenAI via Vercel AI SDK | `OPENAI_API_KEY` |
| `ai-sdk:openrouter` | 300+ models (Anthropic, OpenAI, Google, Meta, …) routed through OpenRouter | `OPENROUTER_API_KEY` |
| `ai-sdk:google` | Google Gemini via Vercel AI SDK | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `ai-sdk:groq` | Groq LPU via Vercel AI SDK | `GROQ_API_KEY` |
| `ai-sdk:mistral` | Mistral via Vercel AI SDK | `MISTRAL_API_KEY` |
| `ai-sdk:cohere` | Cohere via Vercel AI SDK | `COHERE_API_KEY` |
| `ai-sdk:ollama` | Local Ollama via Vercel AI SDK | None (local) |

## Engine Capabilities

Each engine advertises its capabilities:

| Capability | Anthropic | AI SDK: Anthropic | AI SDK: OpenAI | AI SDK: Google |
|---|---|---|---|---|
| `thinking` | ✓ | ✓ | ✗ | ✓ |
| `promptCaching` | ✓ | ✓ | ✗ | ✗ |
| `vision` | ✓ | ✓ | ✓ | ✓ |
| `computerUse` | ✓ | ✗ | ✗ | ✗ |
| `parallelToolCalls` | ✓ | ✓ | ✓ | ✓ |

## Anthropic-Exclusive Features

When using the `anthropic` engine (or `ai-sdk:anthropic`):

- **Prompt caching** is applied automatically to the system prompt — cutting latency and cost on repeated turns.
- **Extended thinking** can be enabled via `providerOptions.anthropic.thinking` — the agent reasons longer before responding.

These features are silently ignored when a non-Anthropic engine is active (capability-gated, no breakage).

## Using OpenRouter

`ai-sdk:openrouter` gives access to 300+ models from many providers through a single API. Model IDs use the `vendor/model` form:

```
set-agent-engine --engine "ai-sdk:openrouter" --model "anthropic/claude-sonnet-4.5"
set-agent-engine --engine "ai-sdk:openrouter" --model "openai/gpt-4o"
set-agent-engine --engine "ai-sdk:openrouter" --model "google/gemini-2.5-pro"
```

Any `vendor/model` string from [openrouter.ai/models](https://openrouter.ai/models) works — the `supportedModels` list in the registry is a UI hint, not an allow-list.

**App attribution** (optional): pass `appName` / `appUrl` in the engine config to set the `X-OpenRouter-Title` / `HTTP-Referer` headers — useful to see your app on the OpenRouter dashboard and leaderboards:

```ts
createAISDKEngine("openrouter", {
  apiKey: process.env.OPENROUTER_API_KEY,
  appName: "My App",
  appUrl: "https://myapp.example",
});
```

## Registering a Custom Engine

Register custom engines in a server plugin at startup. Import from the
`@agent-native/core/agent/engine` subpath:

```ts
// server/plugins/my-engine.ts
import {
  registerAgentEngine,
  type AgentEngine,
  type EngineEvent,
  type EngineStreamOptions,
} from "@agent-native/core/agent/engine";

registerAgentEngine({
  name: "my-engine",
  label: "My Custom Engine",
  description: "...",
  capabilities: {
    thinking: false,
    promptCaching: false,
    vision: false,
    computerUse: false,
    parallelToolCalls: true,
  },
  defaultModel: "my-model-v1",
  supportedModels: ["my-model-v1", "my-model-v2"],
  requiredEnvVars: ["MY_ENGINE_API_KEY"],
  create: (config): AgentEngine => ({
    name: "my-engine",
    label: "My Custom Engine",
    defaultModel: "my-model-v1",
    supportedModels: ["my-model-v1", "my-model-v2"],
    capabilities: {
      /* same shape as above */
    } as any,
    async *stream(opts: EngineStreamOptions): AsyncIterable<EngineEvent> {
      // yield text-delta / thinking-delta / tool-call / usage events
      // as they arrive, then:
      yield { type: "assistant-content", parts: /* final content parts */ [] };
      yield { type: "stop", reason: "end_turn" };
    },
  }),
});
```

### Engine stream contract

Every engine's `stream(opts)` MUST emit, in order:

1. Zero or more `text-delta`, `thinking-delta`, `tool-call`, and `usage`
   events as they arrive from the model.
2. Exactly one `{ type: "assistant-content", parts }` event with the
   structured content for the turn. `runAgentLoop` reads this to
   reconstruct the assistant message for the next turn.
3. Exactly one terminal `{ type: "stop", reason }` event.

After registering, the engine appears in `list-agent-engines` output and can
be selected via `set-agent-engine`.

## Env Vars Reference

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required for `anthropic` and `ai-sdk:anthropic` engines |
| `OPENAI_API_KEY` | Required for `ai-sdk:openai` |
| `OPENROUTER_API_KEY` | Required for `ai-sdk:openrouter` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Required for `ai-sdk:google` |
| `GROQ_API_KEY` | Required for `ai-sdk:groq` |
| `MISTRAL_API_KEY` | Required for `ai-sdk:mistral` |
| `COHERE_API_KEY` | Required for `ai-sdk:cohere` |
| `AGENT_ENGINE` | Default engine name (overridden by settings store) |
