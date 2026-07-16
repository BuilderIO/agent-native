---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Preserve durable `ask_app` task handles and return retryable status-read details when transient polling transport failures outlast bounded retries.
