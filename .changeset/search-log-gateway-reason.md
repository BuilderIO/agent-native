---
"@agent-native/core": patch
---

When an embedding provider refuses a request, its error now carries the provider's code and message, so search's logs say why. Builder's gateway answers 429 for several causes, and only its reply says which.
