---
"@agent-native/core": patch
---

Reduce noisy browser Sentry captures by filtering public-site source-less errors that only report their page URL as a Sentry tag, delaying reconnect aborts until active runs are truly stuck on the server clock, and recovering assistant-ui duplicate message-id append races before they escape.
