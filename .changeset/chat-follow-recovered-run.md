---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Keep agent chat on a turn the server recovers after a crash: an open chat follows the successor run live, a reload no longer shows the interrupted attempt as a failed run above the answer, and a failed run's card stays in its own turn instead of moving below newer replies.
