---
title: "feat: Builder AI backend as a pluggable agent engine"
type: feat
status: blocked
date: 2026-04-10
---

# Builder AI Backend as a Pluggable Agent Engine

## Overview

Add a `BuilderEngine` that routes LLM calls through Builder's hosted `ai-services` backend. This gives users of Builder-hosted agent-native deployments a single-key setup: drop in one Builder private key (`bpk-...`) instead of wiring up `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, Bedrock credentials, Vertex credentials, and so on. Builder handles multi-provider routing, automatic provider fallback (Anthropic direct -> Bedrock -> Vertex), token counting, billing, and rate limiting — all of which already exist inside `ai-services` as `completionLLM()`.

**Value prop:**

- One key (`BUILDER_PRIVATE_KEY=bpk-...`) replaces N per-provider keys.
- Users get multi-provider model access (Claude Opus/Sonnet, GPT-5.4, Gemini 2.5) without signing up for each vendor.
- Builder's internal provider hierarchy handles outages transparently — if Anthropic direct is degraded, requests fall through to Bedrock or Vertex without the caller seeing anything.
- Billing is unified in Builder's existing credit system; traffic shows up on the existing Builder dashboards.
- This is the recommended engine for Builder-hosted agent-native apps. Self-hosted apps can still use the direct `anthropic` or `ai-sdk:*` engines with their own keys.

This plan lands a **third engine** on top of the existing `AgentEngine` registry (see "Dependencies" below). It is purely additive on the agent-native side — no existing engine code changes except a single `registerAgentEngine()` call in `builtin.ts` and a small tweak to the engine picker UI.

## Status: Blocked

This plan is **blocked** on the corresponding `ai-services` PRD landing first.

- **Blocker:** `ai-services` must expose `POST /agent/messages` and `GET /agent/models`. That work is described in a separate PRD (`agent-native-llm-gateway.mdx`) which has been submitted to the ai-services team for approval. Until those endpoints exist (and their wire format is agreed on), `BuilderEngine` has nothing to call.
- **Purpose of this file:** Placeholder so we can pick this plan up as soon as the ai-services team approves the PRD (or revise it according to their feedback). Keeping the agent-native-side plan written down now means we don't lose context on the details when we come back.
- **When to unblock:** After the `ai-services` team either (a) approves `agent-native-llm-gateway.mdx` as-is and ships the endpoints, or (b) gives feedback that changes the wire format — in which case the "What gets built" section below needs to be updated before starting implementation.

## Dependencies

### 1. In-flight engine refactor (agent-native)

The `AgentEngine` abstraction — the whole `packages/core/src/agent/engine/` tree — is currently being landed in a parallel refactor (the "engine registry" work on branch `updates-85`). Files already exist on disk: `types.ts`, `registry.ts`, `builtin.ts`, `anthropic-engine.ts`, `ai-sdk-engine.ts`, `translate-anthropic.ts`, `translate-ai-sdk.ts`. Built-in engines are `anthropic` (direct SDK) and `ai-sdk:*` (multi-provider via the Vercel AI SDK).

This plan sits **entirely on top** of that refactor. Every file referenced below — `builtin.ts`, `anthropic-engine.ts`, `docs/agent-engines.md`, the agent-engines skill, the mail template engine picker — only exists after the in-flight refactor merges. Do not start implementation until the refactor is on `main`, otherwise we'll be editing files mid-refactor and hit rebase pain.

### 2. ai-services endpoints (new PRD, blocker)

See "Status: Blocked" above. The wire format below assumes the ai-services endpoints exist and match the expected shape.

## Architecture

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  agent-native app       │         │  ai-services                 │
│  (Builder-hosted)       │         │  packages/service            │
│                         │         │                              │
│  BuilderEngine.stream() │ ──POST──▶ /agent/messages              │
│    apiKey: bpk-…        │  HTTP    │   authMiddleware             │
│    baseURL: https://…   │  JSONL   │   validateAICreditsMiddleware│
│                         │  stream  │   │                          │
│  ← parse EngineEvent    │ ────────── completionLLM()              │
│    JSONL lines          │          │     ↓                        │
│                         │          │   anthropic / openai /       │
│                         │          │   gemini / bedrock / vertex  │
└─────────────────────────┘         └──────────────────────────────┘
```

**Wire format.** JSONL. Each line is a JSON object that matches agent-native's `EngineEvent` union exactly: `text-delta`, `thinking-delta`, `tool-call-delta`, `tool-call`, `usage`, `stop`. Because the wire events are structurally identical to `EngineEvent`, `BuilderEngine` does zero translation — it's a one-line `JSON.parse` per line. This is the central simplification of the whole design: both sides own the type, so we ship bytes that already match the consumer shape.

**Auth & billing.** `ai-services` reuses its existing `readCredentials()` + `validateAICreditsMiddleware`. The agent-native side just passes `Authorization: Bearer bpk-...`. No new billing code on either side.

**Provider fallback.** Handled inside `ai-services` via `getModelHierachy()`. The caller (agent-native) never sees it. If Anthropic direct goes down, the user's chat keeps working.

## What Gets Built

### New file: `packages/core/src/agent/engine/builder-engine.ts`

Implements `AgentEngine` by `fetch()`-ing the Builder gateway. Structure mirrors `anthropic-engine.ts`.

- **Constructor** takes `{ apiKey: string; baseURL?: string; model?: string }`.
  - `apiKey` is the `bpk-...` private key.
  - `baseURL` defaults to `https://ai.builder.io` (override via `BUILDER_AI_BASE_URL` env var or per-call config).
  - `model` defaults to `agent-native-default` (the Builder-side alias for the Claude Sonnet 4.6 provider hierarchy).
- **`capabilities`**: `{ thinking: true, promptCaching: true, vision: true, computerUse: false, parallelToolCalls: true }`. The engine advertises the _union_ of capabilities across supported models; if the user picks a non-Claude model, runtime silently ignores `thinking` / `cacheControl` opts (same behavior as the current AI SDK engine).
- **`stream()`** method body:
  1. Build the JSON request body from `EngineStreamOptions` — `{ model, system, messages, tools, maxTokens, temperature, reasoning, providerOptions }`.
  2. `fetch(baseURL + "/agent/messages", { method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", Accept: "application/jsonl" }, body: JSON.stringify(req), signal: abortSignal })`.
  3. On non-2xx response, read the error body and yield `{ type: "stop", reason: "error", error: <structured> }`, then return.
  4. Stream the response body via `response.body?.getReader()`. Decode to text, split on `\n`, buffer partial lines across reads. For each complete non-empty line, `JSON.parse` and yield the result as an `EngineEvent`.
  5. Accumulate the assistant content parts as they arrive (text deltas -> text part, tool-call events -> tool-call part, thinking deltas -> thinking part) and stash the final assistant content via the `ASSISTANT_CONTENT_KEY` side-channel — mirroring exactly what `AnthropicEngine` does today. `runAgentLoop` reads that key to append the assistant turn to the message history.

The `ASSISTANT_CONTENT_KEY` side-channel is a wart (the in-flight refactor may eventually clean it up by adding a `final-assistant` event to the `EngineEvent` union), but for now `BuilderEngine` matches the `AnthropicEngine` pattern to stay consistent and unblock landing.

### Modify: `packages/core/src/agent/engine/builtin.ts`

Add a single `registerAgentEngine()` call inside `registerBuiltinEngines()`:

```ts
registerAgentEngine({
  name: "builder",
  label: "Builder AI Backend",
  description:
    "Route LLM calls through Builder's hosted backend. One private key, multi-provider routing, automatic token counting and billing. Recommended for Builder-hosted agent-native apps.",
  capabilities: {
    thinking: true,
    promptCaching: true,
    vision: true,
    computerUse: false,
    parallelToolCalls: true,
  },
  defaultModel: "agent-native-default",
  supportedModels: [
    "agent-native-default",
    "anthropic-claude-4-6-opus",
    "anthropic-claude-4-6-sonnet",
    "openai-gpt-5.4",
    "openai-gpt-5.4-mini-20260317",
    "vertexai-gemini-2-5-pro",
    "vertexai-gemini-2-5-flash",
  ],
  requiredEnvVars: ["BUILDER_PRIVATE_KEY"],
  create: (config) => createBuilderEngine(config),
});
```

The `supportedModels` list is a static fallback. A follow-up can fetch `GET /agent/models` on first use and cache the dynamic list, but seeding the static list means `createBuilderEngine()` never needs a network call at construction time.

### New tests: `packages/core/src/agent/engine/builder-engine.spec.ts`

- Mock `fetch` with a canned JSONL response body (`text-delta` lines, `tool-call-delta` + `tool-call`, `usage`, `stop`).
- Drive `BuilderEngine.stream()` and assert the yielded `EngineEvent`s match 1:1.
- Assert the request body is well-formed JSON with the expected fields.
- Assert `Authorization: Bearer bpk-test` header is set.
- Assert non-2xx responses surface as a `stop` event with `reason: "error"` instead of throwing.
- Assert partial-line buffering works: feed a response body split at arbitrary byte boundaries inside a JSON line and confirm the parser reassembles correctly.

### Engine picker UI tweak

The in-flight refactor lands an engine picker at `templates/mail/app/components/agent-engine-picker.tsx` (wired into `templates/mail/app/routes/settings.agent.tsx`). Builder will appear in the engine list automatically via `list-agent-engines` once registered. Two small UI tweaks are needed:

- When `engine === "builder"` is selected, show a **"Builder Private Key (bpk-...)"** input field with a link to `https://builder.io/account/space` where users can generate one. The field writes to the `BUILDER_PRIVATE_KEY` env var via the existing env-vars flow.
- Hide the per-provider key fields (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) when Builder is selected — they're not needed.

The existing `test-agent-engine` action already runs a trivial "reply with OK" prompt through any registered engine, so it will work against `BuilderEngine` automatically once registered. No additional code needed for the test-connection button.

### Docs

Add a "Builder AI Backend" section to `docs/agent-engines.md` (which the in-flight refactor creates). Cover:

- When to use Builder vs. direct Anthropic vs. `ai-sdk:*`.
- How to obtain a `bpk-...` key at `https://builder.io/account/space`.
- Env var setup: `BUILDER_PRIVATE_KEY`, optional `BUILDER_AI_BASE_URL`, `AGENT_ENGINE=builder`.
- Supported models and how Builder handles provider fallback internally.
- Billing model — credits are deducted per call against the owner of the private key.

### Skill

Add a "Builder AI Backend" entry to `packages/core/.agents/skills/agent-engines/SKILL.md` (created by the in-flight refactor). Include the same capabilities table and env var requirements so the agent knows when to suggest this engine.

## Resolution Order

The existing `resolveEngine()` in `registry.ts` already supports any registered engine by name, so no changes are needed there. Users select `builder` via (in priority order):

1. `createAgentChatPlugin({ engine: "builder" })` in a template's server plugin.
2. Settings store key `agent-engine.engine = "builder"` (written by the picker UI).
3. Env var `AGENT_ENGINE=builder`.

And `BUILDER_PRIVATE_KEY` (env var or per-call config override) supplies the key.

## Wire Format Expectations

The Builder gateway returns JSONL lines that match the `EngineEvent` union exactly:

| Event             | Shape                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `text-delta`      | `{ type: "text-delta", text: string }`                                                                              |
| `thinking-delta`  | `{ type: "thinking-delta", text: string }`                                                                          |
| `tool-call-delta` | `{ type: "tool-call-delta", id: string, name: string, argsTextDelta: string }`                                      |
| `tool-call`       | `{ type: "tool-call", id: string, name: string, input: unknown }`                                                   |
| `usage`           | `{ type: "usage", inputTokens: number, outputTokens: number, cacheReadTokens?: number, cacheWriteTokens?: number }` |
| `stop`            | `{ type: "stop", reason: "end_turn" \| "tool_use" \| "max_tokens" \| "stop_sequence" \| "error", error?: string }`  |

Because these are identical to `EngineEvent`, `BuilderEngine` does zero translation. The line-splitting/buffering loop is the only parsing logic it owns.

## Coordination With the In-Flight Refactor

One tweak to `EngineEvent` is needed before this plan can land, and it needs to be coordinated with whoever is driving the in-flight refactor so we don't conflict on rebase:

- **Add `tool-call-delta` to the `EngineEvent` union.** The wire format above relies on it for incremental tool-argument streaming — the Builder gateway streams tool args as they're generated so the UI can render tool arg JSON character-by-character. `runAgentLoop` ignores `tool-call-delta` for dispatch (only the terminal `tool-call` with fully-parsed `input` triggers tool execution) but forwards it as an `AgentChatEvent` to the chat UI.
- **Teach `AnthropicEngine` to emit `tool-call-delta`.** Parse Anthropic's `input_json_delta` content-block events and translate them to `tool-call-delta` so the new wire event is supported by both engines, not just Builder. This keeps behavior consistent across engines — the chat UI should render tool arg streaming identically regardless of which engine is active.

Both changes are small (a new variant on the union plus a translation case in `translate-anthropic.ts`) and should be coordinated with the in-flight refactor agent. If the refactor has already landed by the time we pick this up, these become part of this plan; if the refactor is still open, we should bundle these changes into it to avoid churn.

## Failure Handling

**Fail hard on Builder backend errors.** No silent fallback to direct Anthropic. Builder's internal hierarchy (`getModelHierachy()`) already covers provider outages — the caller never needs its own fallback.

- **Non-2xx responses** surface as a `{ type: "stop", reason: "error", error: <body> }` event so the chat UI can render a clean error message.
- **402 credit exhaustion** surfaces the structured error body through as the `error` field. The ai-services side is expected to return something like `{ type: "credit_exceeded", topUpUrl: "https://builder.io/account/billing" }`; the chat UI can detect this shape and render a "Top up credits" link. We may later promote this to a dedicated `stop` reason (`reason: "credit_exceeded"`) if it proves useful, but starting with structured-error-in-`error`-field avoids expanding the `EngineEvent` union prematurely.
- **Network errors / aborts** pass through via the `AbortSignal` same as every other engine — no special handling.

## Testing and Verification

- `pnpm run prep` in the framework repo — typecheck, lint, unit tests (including the new `builder-engine.spec.ts`).
- Manual end-to-end in `templates/mail`:
  ```
  BUILDER_PRIVATE_KEY=bpk-... AGENT_ENGINE=builder pnpm dev
  ```
  Open the chat, send "hello world", verify streaming reply, verify tool calls (for example, "list my emails") work identically to the direct Anthropic engine.
- Flip the engine picker in `settings.agent` between `anthropic`, `ai-sdk:openai`, and `builder` — all three should produce indistinguishable chat behavior for a simple prompt.
- Click "Test connection" on Builder in the picker — should return `ok: true, latencyMs: ...`.
- Credit exhaustion: coordinate with ai-services to seed a `bpk-test` key at zero credits, verify the chat UI shows the structured error cleanly instead of crashing.
- Bill dashboard: verify traffic from the test session appears under the `source: agent-native` credit category (that category is added on the ai-services side per the companion PRD).

## Sequencing

In order:

1. **ai-services team approves** `agent-native-llm-gateway.mdx` PRD (or gives feedback that changes the wire format — update this plan accordingly).
2. **ai-services ships** `POST /agent/messages` and `GET /agent/models`, with the JSONL wire format matching `EngineEvent`.
3. **In-flight `AgentEngine` refactor merges** on agent-native `main`.
4. **This plan can be picked up.** At that point, unblock the status (`status: in-progress`) and start implementation. The agent-native-side changes are a single afternoon's work — the hard part is the ai-services side, which is already done by step 2.

## Out of Scope

- Fine-grained credit metering UI on the agent-native side (beyond surfacing the credit-exhausted error). Credit display/top-up flows live in Builder's account UI, not inside agent-native apps.
- Model auto-discovery. `GET /agent/models` exists but the initial implementation uses the static `supportedModels` list in `builtin.ts`. Dynamic model discovery is a reasonable follow-up, not a blocker.
- Multi-key support (different `bpk-` per user inside a single deployment). Agent-native is single-tenant; one deployment = one Builder key.
- Anthropic-compatible wire shim for third parties. Both sides of this are Builder-owned, so we use the cleaner JSONL format. If an external consumer ever needs Anthropic-compatible streaming, we can add a `/agent/messages?format=anthropic` variant without touching the JSONL path.

## Sources

- **Draft technical spec (both repos):** `~/.claude/plans/nested-exploring-feigenbaum.md` — the original cross-repo plan this file is derived from. Part 2 ("agent-native changes") maps directly to the "What Gets Built" section here; Part 1 ("ai-services changes") is the companion PRD (`agent-native-llm-gateway.mdx`).
- **Engine abstraction (agent-native, in-flight refactor):**
  - `packages/core/src/agent/engine/types.ts` — `EngineEvent`, `EngineStreamOptions`, `AgentEngine`
  - `packages/core/src/agent/engine/registry.ts` — `registerAgentEngine`, `resolveEngine`
  - `packages/core/src/agent/engine/anthropic-engine.ts` — pattern to mirror, including `ASSISTANT_CONTENT_KEY` usage
  - `packages/core/src/agent/engine/builtin.ts` — where to register the new engine
  - `packages/core/src/agent/engine/translate-anthropic.ts` — where to add `input_json_delta` -> `tool-call-delta` translation
- **Reference implementations in `ai-services` (for context only — no edits):**
  - `packages/service/genai/llm/index.ts` — `completionLLM()` dispatcher
  - `packages/service/genai/types.ts` — `BaseStream` interface
  - `packages/service/auth.ts` — `readCredentials()` handles `bpk-` auth
  - `packages/service/middleware/ai-credits.ts` — credit validation
  - `packages/service/genai/llm/model-configs.ts` — model hierarchy + full list
