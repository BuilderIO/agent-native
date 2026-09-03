---
"@agent-native/core": patch
---

Publish WebMCP registration progress so a partial tool list is distinguishable
from a complete one. Tools register one at a time, so a discovery caller that
read `document.modelContext.getTools()` mid-flight saw a truncated list with no
way to tell it was truncated, and reported live tools as missing. Read the new
state with `getAgentNativeWebMcpStatus()`, or from the page world via
`window.__agentNativeWebMcpStatus`, which reports `registering`, `ready`, or
`failed` with registered/total counts.
