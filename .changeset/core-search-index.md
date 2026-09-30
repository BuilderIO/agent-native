---
"@agent-native/core": patch
---

Add a core search index that apps opt into with `registerSearchableResource`, fed by a general resource change feed that captures every write with database triggers. Search answers from the index only when it is current and never polls, so it never wakes a sleeping database. The query parser moves to `@agent-native/core/search-query`.
