---
"@agent-native/core": patch
---

Stop blind-retrying 429s from a customer's own provider key: retry once only when the provider sends `Retry-After`, otherwise fail fast after the backup-model attempt. Model-call metrics now carry `agent_native.credential.owner` (`builder`, `deployment`, or `customer`) so own-key rate limits can be split from platform errors.
