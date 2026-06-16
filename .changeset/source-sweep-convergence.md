---
"@agent-native/core": patch
---

Stop repeated read-only source sweeps from looping indefinitely by forcing a final coverage summary after the same provider/search tool is called many times in one turn.
