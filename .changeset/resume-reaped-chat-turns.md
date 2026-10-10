---
"@agent-native/core": patch
---

Resume recovered background chat turns with durable tool results and explicit unknown-outcome context instead of replaying the original request from scratch.

Block repeated calls to a write tool after an uncertain live outcome, refresh verification reads, and preserve definite pre-execution refusals at their own action boundary.

Persist the tool-start marker before invoking writes. Classify handler failures as unknown outcomes regardless of error type; schema and authorization failures before handler entry remain definite refusals.
