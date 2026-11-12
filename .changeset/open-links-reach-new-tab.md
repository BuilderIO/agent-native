---
"@agent-native/core": patch
---

Make `/_agent-native/open` links focus what they point to again. The route wrote its `navigate` command to the account-wide row, which no tab has read since tabs got their own rows, so a Calendar link opened on today's week instead of the event's. The route now picks the new tab's ID, writes `navigate:<tabId>`, and passes the ID on the redirect for the page to adopt.
