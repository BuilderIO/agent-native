---
"@agent-native/core": patch
---

Keep tool-call replay scoped to the turn so reused provider IDs preserve prior results, and safely attach duplicate queued submissions to their live run.
