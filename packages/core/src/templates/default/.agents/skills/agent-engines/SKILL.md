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

## Registering a Custom Engine

Register custom engines in a server plugin at startup:

```ts
// server/plugins/my-engine.ts
import { registerAgentEngine } from "@agent-native/core/server";

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
  create: (config) => new MyEngine(config),
});
```

After registering, the engine appears in `list-agent-engines` output and can be selected via `set-agent-engine`.

## Env Vars Reference

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required for `anthropic` and `ai-sdk:anthropic` engines |
| `OPENAI_API_KEY` | Required for `ai-sdk:openai` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Required for `ai-sdk:google` |
| `GROQ_API_KEY` | Required for `ai-sdk:groq` |
| `MISTRAL_API_KEY` | Required for `ai-sdk:mistral` |
| `COHERE_API_KEY` | Required for `ai-sdk:cohere` |
| `AGENT_ENGINE` | Default engine name (overridden by settings store) |
