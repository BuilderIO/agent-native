---
"@agent-native/core": minor
---

Comments & Review Kit: apps moving their own comments onto the kit can write both stores for a release. `mirrorReviewComments(resource, copies)` makes the kit's rows match the app's comments, joining the app's transaction when called inside one; `deleteMirroredReviewComments(resource, ids | "all")` marks the app's deleted comments deleted; and `compareMirroredReviewComments(resource, copies)` lists what's missing, extra or different, so the app switches only once the two agree. A copied comment whose ID the kit holds on another resource is refused with the new `ReviewCommentResourceConflictError`. A resource registered with `commentsWrittenByApp` is read-only through the kit's actions while the app still writes its comments, and the new `insideDbTransaction()` tells code whether it runs inside a caller's transaction, PGlite's included. Slides now mirrors every comment write into the kit and copies its existing comments once at startup.
