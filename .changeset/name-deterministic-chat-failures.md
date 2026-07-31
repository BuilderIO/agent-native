---
"@agent-native/core": patch
---

Name the two deterministic provider failures that were ending chats as `unknown`: a model rejecting tools alongside `reasoning_effort`, and a missing authentication header. Both now carry a real error code and user-facing copy that says what to change, and both stay non-recoverable so nothing retries a failure a retry cannot fix.
