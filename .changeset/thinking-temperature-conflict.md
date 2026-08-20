---
"@agent-native/core": patch
---

Stop sending a temperature Anthropic always rejects when extended thinking is on.

Anthropic returns `400 invalid_request_error: temperature may only be set to 1 when thinking is enabled or in adaptive mode`. Both sides of that combination were ordinary defaults: `temperature` is a documented `completeText` option, and thinking is on unless the model rules it out, because an absent reasoning effort resolves to `DEFAULT_REASONING_EFFORT`. So `completeText({ temperature: 0.7 })` failed on every Claude reasoning model, surfacing as an opaque 500 from whatever action made the call — a generated app asking for creative output hit it immediately.

The Anthropic and AI SDK engines now drop a conflicting temperature and warn once, naming the value and model. An explicit `1` is passed through, since the provider accepts it, and models that take no thinking block keep their temperature unchanged.
