---
"@agent-native/core": patch
---

Let the Anthropic provider reach a configured base URL, so a self-hosted or
local Anthropic-compatible gateway is a supported configuration rather than a
detour through an OpenAI-shaped translation. `ANTHROPIC_BASE_URL` resolves with
the same precedence `OPENAI_BASE_URL` already had — an explicitly passed
endpoint, then the scoped `app_secrets` row, then the deployment env var — and
applies to both the native `anthropic` engine and `ai-sdk:anthropic`. Which
providers have a configurable endpoint is now one table rather than a name check
at each call site, so the agent-engine settings endpoint writes an Anthropic
gateway to its own key instead of answering "Endpoint URL is only supported for
OpenAI" — without that, the scoped tier the resolver prefers was unreachable and
only the deployment env var worked.

The two Anthropic clients disagree about what a base URL is: the official SDK
appends `/v1/messages`, `@ai-sdk/anthropic` appends only `/messages`. One
configured value now converts to whichever form the selected engine needs, so
the same gateway URL does not 404 on one of them. A resolved endpoint is passed
to the SDK explicitly so a scoped row beats the SDK's own `ANTHROPIC_BASE_URL`
read; with nothing resolved the SDK default is left alone, because callers that
construct the engine directly never reach the registry.

Fail-closed behaviour is unchanged: with neither a key nor a base URL
configured, the engine still stops with the missing-credentials message instead
of sending an unauthenticated request. Only a configured base URL makes a
keyless run deliberate.
