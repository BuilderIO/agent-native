---
"@agent-native/core": patch
---

Accept an active Better Auth session token as a bearer credential, so the Clips Chrome extension stays signed in when the browser session has no legacy session row. Reject expired Better Auth tokens presented in framework session cookies.
