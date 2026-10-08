---
"@agent-native/agentkit": patch
"@agent-native/core": patch
---

Recover completed chat runs when terminal replay is briefly incomplete, keep invalid gateway requests from retrying as transient errors, classify completion timeouts with a stable error code, and preserve retries for no-detail transient gateway codes.
