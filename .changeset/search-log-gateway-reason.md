---
"@agent-native/core": patch
---

When an embedding provider refuses a request, its error now carries the provider's error code as `code`, and search's log lines print it. Builder's gateway answers 429 for several causes, and only its code says which. Only a code that is a plain identifier is kept, and the provider's message is left out, so no page text can reach the logs. The error's message is unchanged. A refusal whose reply stalls past the timeout or the caller's signal now still reports its status and Retry-After.
