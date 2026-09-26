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
| `list-agent-engines` | List all registered engines, their capabilities, the current selection, and whether you can change the organization default (`canUpdateDefault`) |
| `set-agent-engine` | Set the organization's default engine and model (owners and admins only) |
| `test-agent-engine` | Send a trivial prompt to verify the engine works (connectivity + API key) |
| `check-provider-key` | Check a provider API key by listing the models it reaches, before saving it |
| `get-provider-models` | Read which models each provider shows in the model picker and default-model select |
| `manage-provider-models` | Choose those models (`set`) or go back to the recommended ones (`reset`) |
| `list-model-providers` | What Settings › Model shows: each provider's organization and personal key (masked), rejections, the restriction, and the stored default |

## Checking the Current Engine

```
list-agent-engines
```

Returns the registry of all engines (name, label, capabilities, supported models) plus the currently active engine and model. `supportedModels` is what the model picker offers: the provider's checked models when `modelSelection.state` is `"selected"`, otherwise its `recommendedModels`. `credentialRejected: true` means the provider rejected that engine's saved key (`credentialRejectedAt` says when); chats with it stop until the key is replaced, so tell the user.

## Switching Engines

```
set-agent-engine --engine "ai-sdk:openai" --model "gpt-4o"
```

Changes take effect on the next conversation. The default belongs to the organization (the `agent-engine` org setting), and only owners and admins can change it. A member's call is refused with an error to relay: ask an owner or admin, or pick a model for this chat in the model picker. A user with no organization sets their own default.

Resolution order (highest priority first):
1. Explicit `engine` option passed to `createAgentChatPlugin()` in the server plugin
2. The organization's default (`agent-engine` org setting)
3. `AGENT_ENGINE` environment variable
4. Default: `"anthropic"` (requires `ANTHROPIC_API_KEY`)

## Settings › Model

The Model page (`/settings/model`, page id `model`) has three groups:

- **Organization providers:** the organization's Builder.io connection and each organization key. Owners and admins manage them; members see only "N models".
- **Personal providers:** a member's own Builder.io connection, their own keys, and the ChatGPT subscription while its lab is on. A personal key is used before the organization's, for that person only.
- **Organization settings:** Default model (`manage-agent-engine` `set`, organization models only), Restrict personal API keys (`manage-provider-key-policy`), and Max iterations (`manage-agent-loop-settings`, 1 to 1000). Owners and admins change them; members see the values.

Read the page's state with `list-model-providers`, and the models each provider shows with `get-provider-models`. Keys are added and replaced in the provider dialog, which checks a pasted key by listing its models; you can't save a key for the user, so check one with `check-provider-key` and send them to Model (`open-settings-page`) to paste it. Before they remove a provider, run `preview-secret-removal` with the provider's key name and scope and tell them what stops.

## Restricting Personal API Keys

`manage-provider-key-policy` reads or changes the organization's "Restrict personal API keys" setting. While it is on, members (not owners or admins) can't use or save their own provider keys or a personal Builder.io connection, so their chats use organization providers; with none, a chat fails with "Owners and admins restricted personal API keys." Nothing is deleted, and turning it off restores their keys.

```
manage-provider-key-policy            # read; owners/admins also get affectedMembers
manage-provider-key-policy --set true # owners and admins only
```

Read it first and tell the user which members lose which providers before turning it on.

## Testing a New Engine

Before switching, verify the engine is working:

```
test-agent-engine --engine "ai-sdk:openai" --model "gpt-4o"
```

Returns `{ ok, latencyMs, response, capabilities }`. If `ok: false`, the error message explains what's wrong (missing API key, package not installed, etc.).

To check a key without sending a prompt, for example one the user just gave you:

```
check-provider-key --provider "anthropic" --key "<the key>"
```

Returns `{ ok: true, models }` or `{ ok: false, code, reason }` (`rejected`, `wrong-provider`, `missing-key`, `invalid-endpoint`, `unreachable`, `provider-error`). Relay the reason. Omit `--key` to re-check the saved key; it is only checked against its saved endpoint, so `--baseUrl` needs `--key` (except for Ollama). `--scope org` is for owners and admins.

## Choosing Which Models Show

Each provider (Builder.io included) keeps the models its owner checked. Only checked models appear in the chat model picker and the default-model select; Builder.io and providers with their own key show side by side.

```
get-provider-models --provider "openai"
manage-provider-models --action "set" --provider "openai" --models '["gpt-6-sol"]'
manage-provider-models --action "reset" --provider "openai"
```

- A selection lives at the same scope as the provider's key: `--scope user` is the caller's own, `--scope org` is the organization's (owners and admins only; members get an error to relay). Without `--scope`, the call changes the selection in effect, which follows the key in effect (a member's personal key uses their personal selection).
- A member's personal selection never changes the organization's. The default-model select always offers the organization's checked models.
- `set` with an empty list hides the provider's chat models, for a key used only by services. Builder.io accepts only its own catalog.
- A chat already on an unchecked model keeps running on it. When nothing picked a model and the engine default is unchecked, chats use the first checked model.
- A row with `models: null` has nothing chosen and shows the recommended models. `state: "unreadable"` means the selection couldn't be read, not that it is empty.

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
