---
"@agent-native/agentkit": patch
"@agent-native/core": patch
---

Recover completed chat runs when terminal replay is briefly incomplete, keep invalid gateway requests from retrying as transient errors, classify completion timeouts with a stable error code, preserve retries for no-detail transient gateway codes, continue recoverable run timeouts, and reject partial completion when a stream ends cleanly after timeout.
