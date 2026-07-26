---
"@agent-native/core": patch
---

Cut agent spend and false continuation failures: request the 1-hour prompt-cache TTL on the stable system+tools prefix (chunk boundaries average past the 5-minute default), split the system prompt so mid-turn resource churn no longer invalidates that prefix, consult the successor's claim on every failed durable-continuation dispatch, and engage the hosted resume default on A2A/MCP delegated turns.
