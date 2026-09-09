---
"@agent-native/core": patch
---

Record when a share notification was actually emailed (`notified_at` on share
tables) so follow-up email can tell a deliberate share from a silent access
grant.
