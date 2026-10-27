---
"@agent-native/core": patch
---

Keep queued chat follow-ups from taking the run slot while the current turn awaits tool approval, and resume them immediately when the paused turn is explicitly stopped.
Explicitly interrupting an approval-paused turn cancels it before starting the follow-up.
Keep approval pauses attached to the newest admitted turn even when run start times match.
