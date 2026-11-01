---
"@agent-native/core": patch
---

Add `syncInvalidationsAfter()` to `use-db-sync`, which tells a read that answered with a sync cursor which invalidations sync asked for changes after it, including ones asked before anything watched for that read. Export `getCurrentPollBaseline()` from `@agent-native/core/server` so an action can return the cursor it read at.
