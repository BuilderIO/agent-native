---
"@agent-native/core": minor
"@agent-native/toolkit": patch
---

Let people approve an MCP call to a `needsApproval` action in the app when their MCP client can't show an approval prompt, or declines or cancels it. The call returns a normal tool result with a link to a review page. The page requires the same signed-in user and organization and shows the stored arguments in the reader's time zone. Approve and Deny are same-origin POSTs with a per-user token. After an approval, the identical call runs once within ten minutes. The in-client form prompt uses the same summary. A new `zonelessTimes: "calendar"` action option says that a date-time with no offset or zone is read in the calendar's own time zone. The audit log records page approvals as `mcp-review`.
