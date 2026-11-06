---
"@agent-native/core": patch
---

A chat attachment whose only reference is its file id no longer loses its contents. Background dispatch and `reject`-policy saves fail with `attachment_storage_required`, and queueing such a file returns a 503 marked non-retryable with that code, as dispatch does, while a failed upload stays retryable. Saving thread history keeps a visible omitted-bytes stub for it. A queued message now uploads the attachment's inline bytes even when the attachment carries an id.
