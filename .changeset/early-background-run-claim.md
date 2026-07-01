---
"@agent-native/core": patch
---

Claim durable background agent-chat runs before expensive worker setup so hosted apps stay on the 15-minute background-function path instead of falling back to 40-second inline chunks.
