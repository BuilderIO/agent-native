# Design Note: GPT Reasoning Effort on the Builder Gateway

Status: Resolved — guard removed

Date: 2026-09-21 (originally written 2026-09-18)

## Original problem

[`builder-engine.ts`](../../src/agent/engine/builder-engine.ts) forced
`reasoning_effort: "none"` for GPT reasoning models (`gpt-5.6-luna`, the
framework default, and siblings `gpt-5.6-terra` / `gpt-5.6-sol`) whenever
tools were attached — which is nearly every real chat turn or automation run.
The guard's introducing commit (`eecd3adaf5`, 2026-07-31) quoted a literal
OpenAI rejection:

> Function tools with reasoning_effort are not supported for `<model>` in
> `/v1/chat/completions`. To use function tools, use `/v1/responses` or set
> `reasoning_effort` to `'none'`.

and stated that "the gateway routes GPT models there [Chat Completions]." The
initial version of this doc proposed gating the fix behind a deployment-level
app-config flag (`agent.builderGatewayGptResponsesLane`), on the assumption
that the gateway needed a separate migration to the Responses API before the
guard could be safely removed.

## What the investigation found

Two things surfaced that changed the diagnosis:

1. **The team owning the Builder gateway backend (ai-services) reported that
   Luna, Terra, and Sol have used OpenAI's Responses API since they were
   introduced** (2026-07-09, `sdk: "openai"` → `completionOpenAI` →
   `responses.create`), with no Chat Completions path ever existing in that
   gateway's handler. All three models share the identical code path.

2. **The specific Chat Completions rejection quoted in the 2026-07-31 commit
   was traced to a different, unrelated incident**: a Sentry event from
   2026-07-26, on the `ai-sdk:openai` engine (not `builder-engine`), hitting a
   custom OpenAI-compatible proxy (`assets.agent-native.com/.netlify/ai/chat/completions`),
   for `gpt-5.6-sol`. That engine has its own, narrower, already-existing
   guard for exactly this case
   (`forcedChatCompletionsWithTools` in
   [`ai-sdk-engine.ts`](../../src/agent/engine/ai-sdk-engine.ts), scoped to
   `isCustomOpenAiBaseUrl(this.baseUrl)`), added the same day as that
   incident (2026-07-26, `52cce19f63`) — 5 days _before_ the `builder-engine`
   guard.

   The `builder-engine` guard's own comment said "Same guard as the ai-sdk
   engine's forced-Chat-Completions path," which is consistent with an
   engineer generalizing a real, just-fixed incident on one engine onto a
   different engine (a different HTTP client, hitting a different upstream —
   `api.builder.io/agent-native/gateway/v1` vs. the Netlify proxy) without
   independently confirming the Builder gateway had the same constraint.

3. **A live request settled it.** Sent directly through
   `https://api.builder.io/agent-native/gateway/v1/messages` with
   `model: "gpt-5.6-luna"`, 39 tools attached, and `reasoning_effort: "high"`
   (later `"xhigh"`) — the gateway returned `200 OK`. A deterministic
   rejection, had one existed, would have fired on every attempt; it did not.

## Decision

Remove the guard. `builder-engine.ts` now forwards the caller's requested
`reasoning_effort` for GPT reasoning models unconditionally, the same as
every other model family. The `agent.builderGatewayGptResponsesLane`
app-config field this doc originally proposed was never released and has
been deleted rather than defaulted to `true` — there is no pending gateway
migration to gate against, so keeping a flag for a scenario that never
existed on this endpoint would just be an if-statement with a pension plan.

## Consequences

- GPT reasoning models on hosted Builder (chat and automations) now honor
  the caller's requested effort with tools attached, matching Claude's
  existing behavior.
- `ai-sdk-engine.ts`'s narrower `forcedChatCompletionsWithTools` guard is
  unaffected and still correct — it protects a genuinely different scenario
  (a customer-configured custom OpenAI-compatible base URL that only
  implements Chat Completions), unrelated to the Builder gateway.
- `error-detail.ts`'s `provider_config_error` classification for
  `reasoning_effort` + tools should now be rare on the Builder lane; it stays
  in place for the `ai-sdk:openai` custom-baseUrl case and as a defensive
  classification if a future gateway regression reintroduces this shape of
  error.
- Terra and Sol were not independently load-tested the way Luna was, but
  ai-services describes them as sharing the identical `sdk: "openai"` →
  `responses.create` code path, differing only in pricing/context-window
  configuration — not routing.
