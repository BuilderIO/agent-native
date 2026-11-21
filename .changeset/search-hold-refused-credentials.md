---
"@agent-native/core": patch
---

Meaning-search indexing stops retrying pages one by one when the embedding provider refuses its credentials. A 401 or 403 now puts every page with those credentials back for an hour with no attempt counted, and with a `documentBudget` it holds indexing with them on every server, instead of each page making a refused call every few minutes.
