---
"@agent-native/core": patch
---

Indexed search reads each document's search vector only for rows the app's query keeps, and tests all of a query's plain words at once, so a common word no longer reads every user's documents.
