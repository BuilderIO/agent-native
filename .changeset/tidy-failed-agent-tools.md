---
"@agent-native/core": patch
---

Repair unused union-branch transport placeholders and refuse ambiguous input before it can clear unrelated fields. Stop repeated failed tool calls across parallel batches and continuations, preserve a visible failure explanation, and retain progress messages while retrying a stalled model request.
