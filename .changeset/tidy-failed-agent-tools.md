---
"@agent-native/core": patch
---

Repair unused union-branch transport placeholders and refuse ambiguous input before it can clear unrelated fields. Stop repeated failed tool calls across parallel batches and continuations, preserve a visible failure explanation, and retain progress messages while retrying a stalled model request.

Stop plan-mode write rejections through the same failure handler, with a visible instruction to approve the plan and switch to Act mode.

Preserve provider error statuses and recovery guidance when computing repeating-error keys; discard only recognized validation argument echoes.
