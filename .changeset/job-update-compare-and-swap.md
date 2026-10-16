---
"@agent-native/core": patch
---

Apply job and automation edits with a compare-and-swap so a run that records its outcome while an edit is in flight keeps its state. On a conflict the edit is re-applied to the latest job file instead of overwriting it with the snapshot it read; a file that keeps changing fails loudly (`409` for automations, an error for `manage-jobs`) instead of silently reverting a completed run.
