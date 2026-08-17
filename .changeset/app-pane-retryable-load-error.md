---
"@agent-native/core": patch
---

Distinguish a retryable app load failure from an app that is genuinely gone. The chat-first app pane's error branch fell back to `appUnavailable`, rendering "This workspace app is no longer available." above a Retry button.
