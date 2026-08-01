---
"@agent-native/core": patch
---

Carry a durable background agent run on Cloudflare through a queue.

A Worker with the emitted background queue bound resolves the dispatch target's
`queue` arm, and the generated Worker entry exports the consumer alongside the
request handler: per message it enters the per-invocation background scope,
synthesises a request to the existing processor route with the signed internal
token preserved, and delegates to the same handler that serves fetch. The
processor-selection field is honoured, so agent chat, A2A, integration webhooks
and the background route processor all reach the correct processor.

The build emits the producer binding, the consumer registration, and a 300,000 ms
CPU limit into the generated Worker configuration.

An absent binding or a failed send degrades to an inline run with the circuit
breaker unchanged; a queue that accepts a run no consumer ever claims is reported
once per isolate rather than downgraded silently; and an oversized inline-body
payload is refused rather than truncated.
