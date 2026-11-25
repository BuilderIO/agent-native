---
"@agent-native/core": patch
---

Stop approved tool calls from repeating after they already ran: tell the model what actually happened on an approval continuation (already ran, re-paused, failed after execution, or failed before the action handler started) while keeping instructions the approver sent with the approval, including older clients that send that prompt without `approvedContinuationPrompt`, rewrite only the first bounded prompt span so injected screen, attachment, or prepared context is never corrupted, append the outcome note when the original prompt is gone after request preparation, preserve the original request for response guards, carry the rewritten continuation into self-chained successors, resolve a later approval whose client turn id drifted, stop an approval continuation when its turn was stopped, and stop repeating waiting copy across pauses of the same tool.
