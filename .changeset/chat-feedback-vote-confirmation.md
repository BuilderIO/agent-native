---
"@agent-native/core": patch
---

Fix the Chat message feedback (upvote/downvote) icons only looking "selected"
after a click instead of confirming the vote was applied. The vote was already
submitted to the backend, but the buttons had no `aria-pressed`, no distinct
post-submit confirmation state, and no accessible announcement. `ThumbsFeedback`
now sets `aria-pressed` on both buttons, briefly pops the icon and announces
"Feedback submitted" through a polite live region once the request succeeds,
and ignores a stale response from an earlier vote if the user already switched
directions before it resolved.
