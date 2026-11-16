---
"@agent-native/core": patch
---

Read the UI capability mint response body to the end instead of cancelling it, so the request completes normally rather than being reported as aborted, and the page still reaches network idle.
