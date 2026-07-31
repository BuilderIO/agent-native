---
"@agent-native/core": patch
---

Classify AI SDK provider failures that arrive as a stream part, not a throw.
`streamText` does not throw for a failed provider request — it emits an `error`
part on `fullStream` — so provider HTTP failures had two arrival paths and only
the thrown one was classified. The stream-part path built a bare stop event from
the message alone, discarding the `APICallError`'s `statusCode` and
`isRetryable`. Everything downstream then had nothing structured to read: a 429
or 503 was retried only if its prose happened to contain "rate_limit" or
"overloaded", and the run persisted `error_code = 'unknown'`.

That is also why a 100%-reproducible config 400 could run for three days across
five apps without anyone noticing: it was indistinguishable in the outcome
tables from every other unclassified failure, so it had no signature to alert
on.

Both paths now share one `classifyProviderError` helper — status code →
`http_<status>`, transport failure → `provider_network_error`, `isRetryable`
passed through, and a message-based fallback when the provider sent nothing
structured. Every ai-sdk provider (openai, anthropic, google, openrouter, groq,
mistral, cohere, ollama) gets correct classification at once.
