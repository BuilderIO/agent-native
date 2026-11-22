---
"@agent-native/core": patch
---

Meaning-search indexing stops retrying pages every few minutes when the embedding provider refuses its credentials. Indexing now treats a 401 or 403 as a refusal of the credentials: the pages in the refused call wait two hours and are then retried one at a time, and the same owner's other pages wait an hour with no attempt counted. Owners sharing the credentials each learn of the refusal from one call of their own, and with a `documentBudget` the hour holds all indexing with those credentials on every server. If a refusal is about one page's content, the other pages still index, though with a `documentBudget` each retry of that page holds them back for an hour.
