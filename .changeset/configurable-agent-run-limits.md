---
"@agent-native/core": patch
---

Make agent run limits configurable: `toolLimits.maxSameErrorAcrossArguments`, `maxIdenticalErrors` and `maxFailureStreak` for the repeated-error stops, `historyLimits` (`maxToolCalls`, `maxBytes`, `maxValueBytes`) on the chat runtime for follow-up history, and `agent.hostedRunSoftTimeoutCeilingMs` / `agent.maxAutoContinuesPerTurn` for hosted run chunks. Defaults are unchanged.
