---
"@agent-native/core": patch
---

Make progress tracking tolerate blank optional status fields, make extension replacement guard errors retryable when the explicit intent flag is missing, expose extension readiness callbacks for host loading states, show the underlying repeated tool error in agent stop messages, and avoid MCP connection suggestions based on hidden tool payloads.
