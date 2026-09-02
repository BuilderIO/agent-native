---
"@agent-native/core": patch
---

Batch provider secret reads when agent engine detection has to check provider keys. `detectEngineFromUserSecrets` probed each engine's keys one at a time and `resolveSecret` walks four scopes per key, so `/_agent-native/agent-engine/status` cost roughly 50 serial reads per poll for accounts without a Builder connection — bring-your-own-key users, and anyone with no provider configured at all. It now warms the request memo with one batched read per scope. Builder-connected accounts already resolved without reading a provider key and are unaffected.
