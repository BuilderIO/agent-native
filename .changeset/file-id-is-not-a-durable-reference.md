---
"@agent-native/core": patch
---

A chat attachment whose only reference is its file id no longer loses its contents. Background dispatch and `reject`-policy saves fail with `attachment_storage_required`, and queueing such a file returns a non-retryable 422 with that code instead of a retryable 503. Saving thread history keeps a visible omitted-bytes stub for it. A queued message now uploads the attachment's inline bytes even when the attachment carries an id.
