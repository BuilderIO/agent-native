---
"@agent-native/core": patch
---

Reset the Connect Builder.io button after the auth popup is closed or cancelled without confirming credentials, instead of leaving it spinning until the 5-minute timeout. A short grace window still lets a slow-but-real confirmation land, and the button is retryable (or Custom keys is usable) without a page reload.
