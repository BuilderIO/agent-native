---
"@agent-native/core": patch
---

Time out session-replay uploads so a hung request releases the flush lock instead of growing the replay queue for the rest of the session, and bound the extension-marker scan by its watermark instead of reading every marker row ever written.
