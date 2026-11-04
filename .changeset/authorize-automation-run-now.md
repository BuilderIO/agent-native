---
"@agent-native/core": patch
---

Export `authorizeAutomationRunNow` from `@agent-native/core/triggers`: the permission check `queueAutomationRunNow` makes, without queuing a run, so a caller that runs in the request can be held to the same rule.
