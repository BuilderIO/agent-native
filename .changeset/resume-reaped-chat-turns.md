---
"@agent-native/core": patch
---

Resume recovered background chat turns with durable tool results and explicit unknown-outcome context instead of replaying the original request from scratch.

Block repeated calls to a write tool after an uncertain live outcome, refresh verification reads, and preserve definite pre-execution refusals at their own action boundary.
