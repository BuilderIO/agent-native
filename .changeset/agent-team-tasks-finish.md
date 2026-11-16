---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Background tasks started with `agent-teams` now finish in Chat's task list once the agent reads their result, keep their name and description after a reload, and no longer repeat as separate status cards. The answers summary after guided questions is given once. An `@`-mentioned agent's reply shows as one message in its step instead of one row per streamed piece.
