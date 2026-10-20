---
"@agent-native/core": patch
---

Hold a queued chat prompt until the previous reply is stored, so the model never answers it without the reply in view. A replayed queued submission now attaches to its live run instead of failing with "Duplicate AgentKit run id".
