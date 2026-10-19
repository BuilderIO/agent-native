---
"@agent-native/core": patch
---

The org, context-xray, observational-memory and automation trigger-event migrations now belong to framework stores recorded in `_an_store_migrations`. Existing databases import their history instead of re-running it; hosted apps that do not migrate at release keep their previous bookkeeping for these lists.
