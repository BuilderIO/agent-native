---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Queued chat messages are now manageable: each shows a Queued chip and its position, and can be edited in place, reordered, removed, or sent immediately (interrupting the active run). A turn that ended in an error keeps a compact error marker in the transcript instead of losing it as soon as the next message is sent, and the model picker states when a family is listed cheapest first and notes an in-session model switch in the transcript.
