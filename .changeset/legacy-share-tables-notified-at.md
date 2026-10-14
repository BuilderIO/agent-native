---
"@agent-native/core": patch
"@agent-native/creative-context": patch
---

Add the missing `notified_at` column to share tables created before it existed
(`tool_shares`, `data_program_shares`, and the creative-context share tables).
Share inserts name that column, so sharing an extension, data program, or
creative context with a user or org failed on those databases.
