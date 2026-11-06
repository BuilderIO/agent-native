---
"@agent-native/core": patch
---

A chat attachment whose only reference is its file id no longer loses its contents. Saving chat history now rejects it the same way background dispatch does (`attachment_storage_required`), so it is never stored quietly without its bytes. A queued message now uploads the attachment's inline bytes even when the attachment carries an id, and it refuses to queue a file that has no file URL.
