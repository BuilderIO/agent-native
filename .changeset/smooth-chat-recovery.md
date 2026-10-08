---
"@agent-native/agentkit": patch
"@agent-native/core": patch
---

Recover completed chat runs when terminal replay is briefly incomplete, keep invalid gateway requests from retrying as transient errors, and classify completion timeouts with a stable error code.
