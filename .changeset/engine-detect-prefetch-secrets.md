---
"@agent-native/core": patch
---

Batch provider secret reads in agent engine detection. `detectEngineFromUserSecrets` probed each engine's keys one at a time, and `resolveSecret` walks four scopes per key, so `/_agent-native/agent-engine/status` cost roughly 50 serial reads per poll. It now warms the request memo with a single `prefetchSecrets` call, which reads each scope once for the whole key set.
