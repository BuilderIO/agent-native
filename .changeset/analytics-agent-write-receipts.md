---
"@agent-native/core": patch
---

Let a write action return a `_receipt` saying whether it changed anything and whether the change was verified, so the agent loop retries once or annotates the answer when the reply would claim more than the write proved.
