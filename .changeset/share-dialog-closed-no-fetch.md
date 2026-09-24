---
"@agent-native/core": patch
---

`ShareDialog` no longer loads resource shares or the org member list while it is closed. Hosts that mount one closed dialog per list row (such as every Slides deck card) were firing one `/_agent-native/org/members` request per row on page load. `useShareQuery` accepts an optional `enabled` argument.
