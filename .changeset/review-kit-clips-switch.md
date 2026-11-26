---
"@agent-native/core": patch
---

Comments & Review Kit: a registration can set `email.send(comment)` to send a new comment's emails itself, with the app's own recipients and settings. What it returns is the comment's `notified`; returning `null` means the app sends them after the write answers. A keyed comment calls it once, so a retried or duplicate write never sends its emails again. `listReviewCommentReactors(ids)` names who reacted with what on each comment. A keyed write saves its comment as `reviewCommentIdForClientOperation(clientOperationId)`, and resending the key with anything else changed now throws `ReviewCommentSubmissionConflictError` (409 `submission_conflict`) instead of a plain error. `moveMirroredReviewAnchors(resource, moves)` moves comments' anchors when an app changes the resource under them, inside the app's transaction and without its write hook. `listReviewThreadParticipantEmails` is exported. Clips now reads and writes its comments through the kit.
