---
"@agent-native/core": patch
---

Meaning-search indexing stops retrying pages every few minutes when the embedding provider refuses its credentials. Indexing now treats a 401 or 403 as a refusal of the credentials: the pages in the refused call wait two hours and are then retried one at a time, every other page with those credentials waits an hour with no attempt counted, and with a `documentBudget` the hour holds indexing with them on every server. If a refusal is about one page's content, only that page keeps waiting.
