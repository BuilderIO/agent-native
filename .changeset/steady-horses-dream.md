---
"@agent-native/core": patch
---

Preserve repeated tool-call occurrences, pair results by execution-step identity, recover in-flight steps created with the prior provider-ID key, safely attach duplicate queued submissions to their live run, and drain discarded replay streams when the runtime cannot close them.
