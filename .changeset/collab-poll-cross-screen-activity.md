---
"@agent-native/core": patch
---

A collab connection's own poll now counts another tab's resource-scoped action and Yjs events on the open resource as collaborator activity, so a viewer on a different screen of the same design or deck leaves the 1-5 minute idle cadence within one collab poll instead of waiting for the idle poll.
