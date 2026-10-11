---
"@agent-native/toolkit": patch
---

`ShareButton` accepts `basicSharingOnly` for sessions that can run only the list, share, unshare, and visibility actions, such as a scoped MCP App widget session. It omits the access-request review, the agent-context link, and the people suggestions there instead of showing sections that always fail.
