---
"@agent-native/core": patch
---

Stop `/_agent-native/agent-engine/status` reporting a failed lookup as "no AI
provider configured".

The handler swallowed every error and returned `200 { configured: false }`. The
client treats that as an authoritative answer, so a transient database failure
gated the composer and told a user with a working key to go connect a provider.
It now returns 503, which the client maps to its retryable `unavailable` state —
the composer stays usable and the check retries instead of latching.
