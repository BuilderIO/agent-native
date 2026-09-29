---
"@agent-native/core": patch
---

Cast the scheduled failure-alert retry timestamp as `bigint` so PostgreSQL can run lease recovery on empty tables.
