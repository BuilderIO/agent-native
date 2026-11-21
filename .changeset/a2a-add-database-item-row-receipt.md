---
"@agent-native/core": patch
---

Replies that link a Content database row `add-database-item` just created are no longer replaced with "I could not verify the document URL…". The artifact detector and the A2A reply check now read the created row from the action's mutation receipt, as they already did for `upsert-database-item-by-key` and `mutate-content-database-block`, so Slack and `ask_app` answers that name the new row go through. Both now keep a receipt link only when it names that row.
