---
"@agent-native/core": patch
---

Comments & Review Kit: a comment copied with `mirrorReviewComments` can carry its `kind`, `resolutionTarget` and `consumedAt`, for an app that keeps them, and `compareMirroredReviewComments` checks each one a copy names. A copy that leaves one out keeps the kit's value, as before. Plan now mirrors every comment write into the kit and copies its existing comments once at startup.
