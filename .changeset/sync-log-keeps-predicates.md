---
"@agent-native/core": patch
---

Keep each predicate a sync invalidation asked in sync's invalidation log, so a `syncInvalidationsAfter` reader can ask it of the query it holds instead of taking it as reaching every query.
