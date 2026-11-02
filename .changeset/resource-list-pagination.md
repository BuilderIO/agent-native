---
"@agent-native/core": patch
---

Add `--limit`/`--offset` pagination to `resource-list`, sorted by path, with `total`, `hasMore` and `nextOffset` so large directories no longer appear truncated.
