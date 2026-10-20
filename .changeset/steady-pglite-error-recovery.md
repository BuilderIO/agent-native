---
"@agent-native/core": patch
---

Upgrade PGlite to 0.5.9 so repeated failed local queries do not exhaust the database stack-depth budget.
Batch large mounted action catalogs so unrelated requests do not exhaust H3's middleware call stack.
