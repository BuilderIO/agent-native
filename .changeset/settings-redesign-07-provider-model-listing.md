---
"@agent-native/core": minor
---

Provider keys are now checked by asking the provider which models they reach. Add the `check-provider-key` action (`{ provider, key?, baseUrl?, scope? }`) and the `fetchProviderModels` client helper that calls it, for OpenRouter, Ollama, Anthropic, OpenAI and OpenAI-compatible gateways, Google Gemini, Groq, Mistral, and Cohere. A failed check returns `ok: false` with a `code` (`rejected`, `wrong-provider`, `missing-key`, `invalid-endpoint`, `unreachable`, `provider-error`) and a reason such as "This looks like an Anthropic key." or "Groq keys start with gsk\_.". A key with another provider's prefix is refused before it is sent anywhere. A saved key is only checked against its saved endpoint (`baseUrl` without `key` is a 400), and checking the organization's key (`scope: "org"`) is for owners and admins (403 otherwise).

Saving a provider key through `/_agent-native/agent-engine/api-key` now runs the same check for every provider, not only OpenRouter, and refuses a rejected key (400) or one it couldn't verify (502), with the `code` in the response.

A key its provider rejected during a chat now shows as rejected instead of silently being skipped: `GET /_agent-native/secrets` reports `status: "invalid"` with `rejectedAt`, and `manage-agent-engine` `list` reports `credentialRejected` and `credentialRejectedAt`, until a call with the key succeeds or it is replaced.
