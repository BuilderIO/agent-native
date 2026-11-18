---
"@agent-native/core": patch
---

Stop approved tool calls from repeating after they already ran: tell the model what actually happened on an approval continuation (already ran, re-paused, failed after execution, or failed before execution) while keeping instructions the approver sent with the approval, rewrite only the current request's prompt segment so injected screen or attachment context is never corrupted, preserve the original request for response guards, carry the rewritten continuation into self-chained successors, resolve a later approval whose client turn id drifted, stop an approval continuation when its turn was stopped, and stop repeating waiting copy across pauses of the same tool.
