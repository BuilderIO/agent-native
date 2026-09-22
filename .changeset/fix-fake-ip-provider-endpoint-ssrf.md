---
"@agent-native/core": patch
---

Reject custom provider endpoints whose DNS answer is in 198.18.0.0/15. Model requests send that URL through the AI SDK fetch, which does not apply the connect-time SSRF guard.
