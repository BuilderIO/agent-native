---
"@agent-native/core": patch
---

`readBoundedResponseBytes` now throws an exported `RemoteArtifactTooLargeError` when a remote response is over the byte limit, so callers can tell "too large" from a failed read without matching on the message.
