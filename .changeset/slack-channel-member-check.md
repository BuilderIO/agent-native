---
"@agent-native/core": patch
---

The default Slack identity resolver now applies the same member checks to channel mentions as to DMs: guests, external members, and senders whose Slack identity could not be confirmed are declined.
