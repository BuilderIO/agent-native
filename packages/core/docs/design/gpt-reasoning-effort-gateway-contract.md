# Design Note: GPT Reasoning Effort Requires a Responses Lane on the Builder Gateway

Status: Proposed (blocked on Builder gateway team)

Date: 2026-09-18

## Context

Hosted Builder chat and automations send every LLM request through the
Builder gateway's `/messages` endpoint, using an Anthropic-shaped request body
(see [`builder-engine.ts`](../../src/agent/engine/builder-engine.ts)). The
gateway currently proxies GPT models (`gpt-5.6-luna`, the framework default,
and siblings) to OpenAI's Chat Completions API.

OpenAI's Chat Completions API rejects `reasoning_effort` together with
function tools for these models:

> Function tools with reasoning_effort are not supported for `<model>` in
> `/v1/chat/completions`. To use function tools, use `/v1/responses` or set
> `reasoning_effort` to `'none'`.

Because nearly every real agent turn includes tools, `builder-engine.ts` has
always sent `reasoning_effort: "none"` whenever a GPT reasoning model has
tools attached, regardless of what effort the caller (chat UI or an
automation) actually asked for. This is not an oversight — removing it 400s
every GPT + tools request against the gateway as it exists today — but it
means Luna effectively never reasons on hosted Builder, since chat and
automations almost always run with tools available.

## Decision

Route GPT + tools requests through OpenAI's Responses API instead, which
accepts `reasoning_effort` and function tools together. This requires a
gateway-side change (outside this repo); core's role is to describe the
contract and stop forcing `"none"` once the gateway honors it.

### Gateway contract

- The gateway detects GPT models (`gpt-5.*`, `o\d.*`) with `tools.length > 0`
  in the existing Anthropic-shaped `/messages` body and translates internally
  to a Responses API call, on the same auth/billing lane used today. Core does
  not send a different request shape for this — no new header or field is
  required for the gateway to make this decision, since it can inspect model
  - tools the same way `isGPTReasoningModel()` does client-side.
- Streaming JSONL semantics must stay outwardly identical: thinking deltas,
  tool-call deltas, and stop events in the same shape `builder-engine.ts`
  already parses. Reasoning summaries from the Responses API need to map onto
  the same thinking-delta event shape as Claude's extended thinking.
- Claude requests are unaffected — they continue through the existing
  Anthropic-shaped lane.

### Acceptance criteria for the gateway change

- `gpt-5.6-luna` (or another `gpt-5.x`/`o*` model) with function tools and
  `reasoning_effort: "high"` or `"xhigh"` succeeds end to end — no Chat
  Completions rejection.
- The Claude path is unchanged: effort + tools still works exactly as today.
- Load and timeout behavior holds up for the longest automation runs (up to
  the 10-minute background hard timeout in
  [`app-config/agent.ts`](../../src/app-config/agent.ts)'s
  `backgroundRunHardTimeoutMs`).

### Core-side rollout

Core gates the forced `"none"` behind a deployment-wide app-config field,
`agent.builderGatewayGptResponsesLane` (env alias
`AGENT_BUILDER_GATEWAY_GPT_RESPONSES_LANE`), default `false`. This is
infrastructure status, not a per-user or per-org product rollout — every
deployment pointed at a given Builder gateway sees the same behavior — so it
belongs in `defineAppConfig()` rather than the per-app feature-flag system.

Once the gateway change is verified in staging, flipping this flag to `true`
is what lets `builder-engine.ts` forward the caller's actual requested effort
for GPT + tools instead of overriding it to `"none"`. **Do not flip it before
the gateway change ships** — every GPT + tools request would start 400ing
again, exactly as it did before the `"none"` guard was added.

## Consequences

- Until the gateway ships this lane, GPT + tools automations and chat turns
  on hosted Builder continue to run at `reasoning_effort: "none"` regardless
  of what effort the caller configured. Automation `reasoningEffort` (see the
  `automations` skill) still persists and applies immediately for non-GPT
  models (e.g. Claude), and will apply to GPT once this lane is live.
- `error-detail.ts`'s `provider_config_error` classification for
  `reasoning_effort` + tools should become rare once the lane is live and
  enabled; keep it for deployments running a stale gateway or with the flag
  still off.
- The BYOK `ai-sdk:openai` path is unaffected — it already calls the
  Responses API directly except when a custom `baseUrl` forces Chat
  Completions, which is a narrower, separate case.
