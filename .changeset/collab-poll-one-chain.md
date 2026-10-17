---
"@agent-native/core": patch
---

A collaborative document no longer starts a second polling loop when the window regains focus, the tab becomes visible, or sync restarts while a poll is still in flight, and a poll request that never answers is abandoned after 15 seconds so polling resumes.
