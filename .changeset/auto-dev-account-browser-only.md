---
"@agent-native/core": patch
---

The one-time local dev sign-in now waits for a real browser visit. A `curl` health check, or a review browser while `AUTH_DISABLED` is on, no longer uses it up, so the first person to open a fresh local app lands in it instead of on the "Continue as local dev" card.
