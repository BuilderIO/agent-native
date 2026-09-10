---
"@agent-native/core": patch
"@agent-native/scheduling": patch
---

Harden security across CLI action runners and scheduling actions: safely tokenize and quote CLI arguments in fallback action routes to prevent shell command injection, require viewer access on routing form responses, and enforce access checks on event type ID queries.
