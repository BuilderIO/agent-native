---
"@agent-native/core": patch
---

Deleting a review thread's first comment now deletes the whole thread, replies included, instead of leaving the replies behind with no comment to hang them on. Only an editor, or the author of a thread that holds no one else's reply, may do it, and `list-review-comments` reports that per thread as `canDeleteThread`. The check runs inside the delete, after the thread is locked, so a reply that lands at the last moment is checked too, and a reply can no longer be added to a thread that was deleted, even while the delete is running.
