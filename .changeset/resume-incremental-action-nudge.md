---
"@agent-native/core": patch
---

When a long agent run is cut off mid-stream while assembling one large tool input (a generation that exceeds the ~40s soft-timeout window), the auto-continue nudge now points the resumed model at the incremental-edit path for that specific action instead of only handling `create-extension`. Designs (`generate-design` → `edit-design`), plans (`create-visual-plan`/`create-ui-plan` → `update-visual-plan`/`patch-visual-plan-source`), and dashboards (`update-dashboard` incremental `ops`) get tailored "ship a compact first version, then refine" guidance, with a generic compact-first fallback for any other large-payload action. This breaks the re-stream-the-same-oversized-payload thrash loop that could otherwise burn the whole continuation budget without making progress.
