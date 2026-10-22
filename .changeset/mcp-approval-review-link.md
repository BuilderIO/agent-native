---
"@agent-native/core": minor
"@agent-native/toolkit": patch
---

Let people approve an MCP call to a `needsApproval` action in the app when their MCP client can't show an approval prompt, or declines or cancels it. The call returns a normal tool result with a link to a review page. The page reads only the browser's sign-in cookie, requires the same user, organization and app, and shows the stored arguments in the reader's time zone. Approve and Deny are same-origin POSTs with a per-user token. After an approval, the identical call runs once within ten minutes, in the app that asked. A grant's stored arguments are cleared once it is used, denied or expired. The page shows every recipient and argument whole, and says when the server had to cut the stored arguments. The in-client form prompt uses the same summary, says how many recipients and fields it leaves out, and links the page when it shows less. Links go only to an origin the app declares, once it declares one. A new `zonelessTimes: "calendar"` action option says that a date-time with no offset or zone is read in the calendar's own time zone. The audit log records page approvals as `mcp-review`.
