---
"@agent-native/core": patch
---

Replies on a suggested edit save instead of failing with a server error

Every reply on a suggested edit's card failed with "Internal server error" and was
lost. Before saving a reply, the review store looked for a live first comment whose
id matched the thread id, but a suggestion's correction comment has an id of its own
in a `suggestion-thread-` thread, so the check never matched. The store now finds a
thread's first comments by thread, as deleting a thread does, and locks them in the
same order. Under that lock it also checks the thread is still open, so a reply can't
land in a thread resolved a moment earlier; a retry of a reply that already saved
still replays. A reply that can't save now says why: a resolved thread answers 409
with "Reopen it to reply", and a deleted thread or missing comment answers 404.
