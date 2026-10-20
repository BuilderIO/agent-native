---
"@agent-native/core": patch
---

Preserve repeated tool-call occurrences, pair results by execution-step identity, recover in-flight steps created with the prior provider-ID key, and safely attach duplicate queued submissions to their live run.
