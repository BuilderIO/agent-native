---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Add Report a problem under Send feedback in the app sidebar, in the agent panel menu, and in the command menu. It previews what the recorder captured, stores the full report as a private blob only after the user confirms, and sends the agent a summary of at most 8 KB that includes the report's ref; apps without agent chat copy the summary instead. If storage fails, the dialog says the report was not attached. The new read-only `read-problem-report` action lets the agent, or an MCP client, read slices of the report by event type and time. Only the reporting user, in the same organization, can open it.
