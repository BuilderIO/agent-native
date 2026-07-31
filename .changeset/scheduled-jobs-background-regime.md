---
"@agent-native/core": patch
---

Run scheduled jobs, automations, and Google Docs comment replies under the background timeout regime instead of the interactive one. They were inheriting the 40s soft timeout, a 30s no-progress backstop, and 6 continuations meant for a synchronous request, so work that legitimately spends minutes across many tool calls died in the first gap longer than 30s and was recorded as `no_progress`.
