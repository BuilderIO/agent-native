---
"@agent-native/core": patch
---

Chat no longer shows a cut-off assistant reply as complete. When a finished run's events could not be read to its terminal event, the client completes the reply from the server's saved copy, or ends the run with the "lost track of the agent" notice instead of a silent success.
