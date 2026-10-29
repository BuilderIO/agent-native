---
"@agent-native/core": patch
---

Repair unused union-branch transport placeholders and refuse ambiguous input before it can clear unrelated fields. Stop repeated failed tool calls across parallel batches and continuations, preserve a visible failure explanation, and retain progress messages while retrying a stalled model request.

Stop plan-mode write rejections through the same failure handler, with a visible instruction to approve the plan and switch to Act mode.

Keep cached reads from resetting failure counts, including when rebuilding a continuation from durable results. Admit parallel calls within the remaining equivalent-error budget and retain the failure explanation when model closeout is empty.

Keep equivalent-error counts under exact tool names, so colon-containing names cannot share a budget or retain each other's errors across a mutation.

Preserve provider error statuses and recovery guidance when computing repeating-error keys; discard only recognized validation argument echoes.
