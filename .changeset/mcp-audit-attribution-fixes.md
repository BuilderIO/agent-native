---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Keep MCP audit rows and attribute them correctly. A NUL or other control character in an MCP client's self-reported name or version, or a NUL in any other audit value, is now stored as U+FFFD instead of failing the insert and losing the row, and a failed audit write is logged and reported through `captureError` while the audited action still completes. Writes made through `/_agent-native/actions/<action>` with a verified MCP OAuth or connect token now record as `mcp` by the agent, with the credential's OAuth client id, even when the request also sends the frontend header. An approved A2A tool call that runs after its pause now records the paused task's run, thread, turn and network ids. The audit-log event details show the self-reported client, the OAuth client and the approval, with `mcp-client-accepted` labeled as unverified.
