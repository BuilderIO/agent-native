---
"@agent-native/core": patch
---

Revert the serverless database connection change from #2328. Treating connection-exhaustion errors ("max client connections reached" / EMAXCONN / 53300) as retryable turned a full pool into a retry storm under cold-start bursts, exhausting Neon and timing out every function. Connection-exhaustion is no longer retried, and the serverless pool cap returns to 2.
