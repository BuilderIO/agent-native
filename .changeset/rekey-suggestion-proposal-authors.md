---
"@agent-native/core": patch
---

Email changes and member offboarding now also rewrite `author_email` on Content suggestion proposals and their creation records, instead of refusing to run because those columns had no identity policy.
